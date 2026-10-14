"""Propensity Scorer: p(role) = sigmoid(w_role · features).

Four roles: driver, rider, connector, referrer. Weights start from the trained model
(models/scorer.pkl, produced by ml/train_scorer.py) and are then updated online per tenant
after every observed outcome:   w <- w + lr * sample_weight * (y - p) * x
"""
import math
import pickle
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import ModelState, Tenant
from .context import FEATURES

ROLES = ("driver", "rider", "connector", "referrer")

# Naive starting point when no trained model exists (same values as the Growth Simulator).
DEFAULT_WEIGHTS: dict[str, list[float]] = {
    "driver": [0.6, 0.4, 0.2, 0.1, 0.2, -1.6],
    "rider": [0.0, 0.4, 0.2, 0.1, 0.2, -1.2],
    "connector": [0.0, 0.1, 0.1, 0.5, 0.2, -1.6],
    "referrer": [0.0, 0.2, 0.4, 0.3, 0.2, -1.8],
}


def sigmoid(z: float) -> float:
    if z < -40:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


def predict(weights: list[float], x: list[float]) -> float:
    return sigmoid(sum(w * xi for w, xi in zip(weights, x)))


@lru_cache
def load_pretrained(path: str | None = None) -> dict[str, list[float]]:
    """Read scorer.pkl -> {role: [w_has_car, ..., bias]}. Falls back to DEFAULT_WEIGHTS."""
    p = Path(path) if path else get_settings().scorer_path
    if not p.exists():
        return {r: list(w) for r, w in DEFAULT_WEIGHTS.items()}
    with p.open("rb") as fh:
        bundle = pickle.load(fh)
    if bundle.get("features") != FEATURES:
        raise ValueError(f"scorer.pkl was trained on {bundle.get('features')}, engine expects {FEATURES}")
    out = {r: list(w) for r, w in DEFAULT_WEIGHTS.items()}
    for role, model in bundle["models"].items():
        coef = [float(c) for c in model.coef_[0]]
        # The bias feature is the constant 1.0 column; fold the intercept into it.
        coef[-1] += float(model.intercept_[0])
        out[role] = coef
    return out


def tenant_weights(db: Session, tenant: Tenant) -> dict[str, ModelState]:
    rows = {s.role: s for s in db.scalars(select(ModelState).where(ModelState.tenant_id == tenant.id))}
    missing = [r for r in ROLES if r not in rows]
    if missing:
        base = load_pretrained()
        for r in missing:
            rows[r] = ModelState(tenant_id=tenant.id, role=r, weights=list(base[r]), updates=0)
            db.add(rows[r])
        db.flush()
    return rows


def score_member(weights: dict[str, ModelState], x: list[float]) -> dict[str, float]:
    return {r: round(predict(weights[r].weights, x), 4) for r in ROLES}


def learn(state: ModelState, x: list[float], y: int, lr: float, sample_weight: float = 1.0) -> float:
    """One online logistic-regression step. Returns the prediction before the update."""
    w = list(state.weights)
    p = predict(w, x)
    g = (y - p) * sample_weight
    state.weights = [wi + lr * g * xi for wi, xi in zip(w, x)]   # reassign so the JSON column is saved
    state.updates += 1
    return p
