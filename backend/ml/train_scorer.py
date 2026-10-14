"""Train the Propensity Scorer and save models/scorer.pkl.

Training data is SYNTHETIC: we replay synthetic communities through the real engine and log every
nudge outcome (features at the time of the nudge -> responded or not). Random-strategy runs are
included so the data is not biased toward only the members the smart engine already liked.

Usage (from backend/):  python -m ml.train_scorer [--runs 6] [--days 30]
"""
import argparse
import json
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.db import init_db, make_engine  # noqa: E402
from app.engine.context import FEATURES, build_context  # noqa: E402
from app.models import Intervention, Member  # noqa: E402
from app.sim.behaviour import simulate  # noqa: E402
from app.sim.synthetic import create_synthetic_tenant  # noqa: E402

ROLES = ("driver", "rider", "connector", "referrer")
MIN_SAMPLES, MIN_AUC = 100, 0.6   # quality bar; weaker roles fall back to the engine's default weights


def generate_logs(runs: int = 6, days: int = 30, base_seed: int = 100) -> dict[str, list[tuple[list[float], int]]]:
    """Return {role: [(features, label), ...]} from `runs` synthetic communities."""
    engine = make_engine("sqlite://")
    init_db(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    logs: dict[str, list] = {r: [] for r in ROLES}
    for i in range(runs):
        db = Session()
        strategy = "random" if i % 2 else "smart"
        t = create_synthetic_tenant(db, name=f"train-{i}", seed_active=12 + 3 * (i % 3), seed=base_seed + i)
        db.commit()
        simulate(db, t, days, seed=base_seed + 50 + i, strategy=strategy)
        for iv in db.scalars(select(Intervention).where(Intervention.tenant_id == t.id, Intervention.status != "sent")):
            logs[iv.role].append((list(iv.features), 1 if iv.status == "responded" else 0))
        # referrer label: did a registered member go on to bring someone in? (features at end of run)
        ctx = build_context(db, t)
        for m in db.scalars(select(Member).where(Member.tenant_id == t.id, Member.registered_day.is_not(None))):
            logs["referrer"].append((ctx.features(m), 1 if m.referrer_day is not None else 0))
        db.close()
    return logs


def train(logs, holdout_share: float = 0.25, seed: int = 0) -> tuple[dict, dict]:
    rng = np.random.default_rng(seed)
    models, report = {}, {}
    for role, rows in logs.items():
        if len(rows) < 30 or len({y for _, y in rows}) < 2:
            report[role] = {"skipped": True, "samples": len(rows)}
            continue
        X = np.array([x for x, _ in rows], dtype=float)
        y = np.array([y for _, y in rows], dtype=int)
        idx = rng.permutation(len(y))
        cut = int(len(y) * (1 - holdout_share))
        tr, te = idx[:cut], idx[cut:]
        clf = LogisticRegression(max_iter=500, C=1.0)
        clf.fit(X[tr], y[tr])
        auc = roc_auc_score(y[te], clf.predict_proba(X[te])[:, 1]) if len(set(y[te])) > 1 else None
        shipped = len(y) >= MIN_SAMPLES and auc is not None and auc >= MIN_AUC
        if shipped:
            models[role] = clf
        report[role] = {"shipped": shipped, "samples": int(len(y)), "positive_rate": round(float(y.mean()), 3),
                        "holdout_auc": round(float(auc), 3) if auc is not None else None,
                        "weights": dict(zip(FEATURES, [round(float(c), 3) for c in clf.coef_[0]])),
                        "intercept": round(float(clf.intercept_[0]), 3)}
    return models, report


def save(models: dict, report: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    bundle = {"features": FEATURES, "models": models, "report": report,
              "trained_at": datetime.now(timezone.utc).isoformat(), "data": "synthetic (labelled)"}
    with out.open("wb") as fh:
        pickle.dump(bundle, fh)
    out.with_suffix(".json").write_text(json.dumps({k: v for k, v in bundle.items() if k != "models"}, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=6)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--out", type=Path, default=BACKEND / "models" / "scorer.pkl")
    a = ap.parse_args()
    logs = generate_logs(a.runs, a.days)
    models, report = train(logs)
    save(models, report, a.out)
    print(json.dumps(report, indent=2))
    print(f"Saved {a.out}")


if __name__ == "__main__":
    main()
