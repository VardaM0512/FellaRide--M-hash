"""Train the Propensity Scorer and save models/scorer.pkl.

--source synthetic (default): replay synthetic communities through the real engine and log every
nudge outcome (features at the time of the nudge -> responded or not). Random-strategy runs are
included so the data is not biased toward only the members the smart engine already liked.

--source real: read answered nudges from the deployment's database (FELLARIDE_DATABASE_URL), pooled
across all real communities. Features were stored when each nudge was sent, so there is no leakage.
The holdout is the most recent 25% of nudges (train on the past, test on the future).

Usage (from backend/):  python -m ml.train_scorer [--source synthetic|real] [--runs 6] [--days 30]
"""
import argparse
import json
import pickle
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import get_settings  # noqa: E402
from app.db import init_db, make_engine  # noqa: E402
from app.engine import scorer  # noqa: E402
from app.engine.context import FEATURES, build_context  # noqa: E402
from app.models import Intervention, Member, Tenant  # noqa: E402
from app.sim.behaviour import simulate  # noqa: E402
from app.sim.synthetic import create_synthetic_tenant  # noqa: E402

ROLES = ("driver", "rider", "connector", "referrer")
MIN_SAMPLES, MIN_AUC = 100, 0.6   # quality bar; weaker roles fall back to the engine's default weights


@contextmanager
def default_engine_prior():
    """Replay with the engine's DEFAULT_WEIGHTS instead of the scorer.pkl on disk. Otherwise the smart strategy's
    choices, and so the training data, would depend on the previously shipped model (train -> ship -> different
    data next time), and the same code wouldn't always give the same model."""
    settings = get_settings()
    shipped = settings.scorer_path
    settings.scorer_path = shipped.with_name("__no_model__.pkl")
    scorer.load_pretrained.cache_clear()
    try:
        yield
    finally:
        settings.scorer_path = shipped
        scorer.load_pretrained.cache_clear()


def generate_logs(runs: int = 6, days: int = 30, base_seed: int = 100) -> dict[str, list[tuple[list[float], int]]]:
    """Return {role: [(features, label), ...]} from `runs` synthetic communities (deterministic for given seeds)."""
    with default_engine_prior():
        return _replay(runs, days, base_seed)


def _replay(runs: int, days: int, base_seed: int) -> dict[str, list[tuple[list[float], int]]]:
    engine = make_engine("sqlite://")
    init_db(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    logs: dict[str, list] = {r: [] for r in ROLES}
    for i in range(runs):
        db = Session()
        strategy = "random" if i % 2 else "smart"
        t = create_synthetic_tenant(db, name=f"train-{i}", seed_active=12 + 3 * (i % 3), seed=base_seed + i)
        db.commit()
        half = days // 2
        simulate(db, t, half, seed=base_seed + 50 + i, strategy=strategy)
        # referrer label: does a registered member who hasn't referred yet bring someone in during the second
        # half? Features are taken at the midpoint, before the outcome, so the label can't leak into them.
        ctx = build_context(db, t)
        snapshot = [(m.id, ctx.features(m)) for m in ctx.members.values()
                    if m.registered_day is not None and m.referrer_day is None]
        simulate(db, t, days - half, seed=base_seed + 50 + i, strategy=strategy)
        db.expire_all()
        for mid, x in snapshot:
            logs["referrer"].append((x, 1 if db.get(Member, mid).referrer_day is not None else 0))
        for iv in db.scalars(select(Intervention).where(Intervention.tenant_id == t.id, Intervention.status != "sent")):
            logs[iv.role].append((list(iv.features), 1 if iv.status == "responded" else 0))
        db.close()
    return logs


def load_real_logs(url: str | None = None) -> dict[str, list[tuple[list[float], int]]]:
    """Answered nudges from real (non-synthetic) communities, oldest first: {role: [(features, label), ...]}.
    The referrer role has no rows: real members' features aren't stored at a point before they referred."""
    engine = make_engine(url or get_settings().database_url)
    Session = sessionmaker(bind=engine)
    logs: dict[str, list] = {r: [] for r in ROLES}
    with Session() as db:
        q = (select(Intervention).join(Tenant, Tenant.id == Intervention.tenant_id)
             .where(Tenant.is_synthetic.is_(False), Intervention.status.in_(("responded", "ignored")))
             .order_by(Intervention.id))
        for iv in db.scalars(q):
            if len(iv.features) == len(FEATURES) and iv.role in logs:
                logs[iv.role].append((list(iv.features), 1 if iv.status == "responded" else 0))
    return logs


def train(logs, holdout_share: float = 0.25, seed: int = 0, by_time: bool = False) -> tuple[dict, dict]:
    """by_time=True: rows are in time order and the holdout is the newest share (no shuffling)."""
    rng = np.random.default_rng(seed)
    models, report = {}, {}
    for role, rows in logs.items():
        if len(rows) < 30 or len({y for _, y in rows}) < 2:
            report[role] = {"skipped": True, "samples": len(rows)}
            continue
        X = np.array([x for x, _ in rows], dtype=float)
        y = np.array([y for _, y in rows], dtype=int)
        idx = np.arange(len(y)) if by_time else rng.permutation(len(y))
        cut = int(len(y) * (1 - holdout_share))
        tr, te = idx[:cut], idx[cut:]
        clf = LogisticRegression(max_iter=500, C=1.0)
        clf.fit(X[tr], y[tr])
        auc = roc_auc_score(y[te], clf.predict_proba(X[te])[:, 1]) if len(set(y[te])) > 1 else None
        shipped = len(y) >= MIN_SAMPLES and auc is not None and auc >= MIN_AUC
        if shipped:
            models[role] = clf
        report[role] = {"shipped": shipped, "samples": int(len(y)), "split": "time" if by_time else "random", "positive_rate": round(float(y.mean()), 3),
                        "holdout_auc": round(float(auc), 3) if auc is not None else None,
                        "weights": dict(zip(FEATURES, [round(float(c), 3) for c in clf.coef_[0]])),
                        "intercept": round(float(clf.intercept_[0]), 3)}
    return models, report


def save(models: dict, report: dict, out: Path, data: str = "synthetic (labelled)") -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    bundle = {"features": FEATURES, "models": models, "report": report,
              "trained_at": datetime.now(timezone.utc).isoformat(), "data": data}
    with out.open("wb") as fh:
        pickle.dump(bundle, fh)
    out.with_suffix(".json").write_text(json.dumps({k: v for k, v in bundle.items() if k != "models"}, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=("synthetic", "real"), default="synthetic")
    ap.add_argument("--db", help="database URL for --source real (default: FELLARIDE_DATABASE_URL)")
    ap.add_argument("--runs", type=int, default=6)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--out", type=Path, default=BACKEND / "models" / "scorer.pkl")
    a = ap.parse_args()
    if a.source == "real":
        logs = load_real_logs(a.db)
        models, report = train(logs, by_time=True)
        save(models, report, a.out, data="real (answered nudges, pooled across communities)")
    else:
        logs = generate_logs(a.runs, a.days)
        models, report = train(logs)
        save(models, report, a.out)
    print(json.dumps(report, indent=2))
    print(f"Saved {a.out}")


if __name__ == "__main__":
    main()
