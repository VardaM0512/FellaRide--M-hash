"""Metrics, funnel, growth graph, model weights, day clock and synthetic simulation."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..engine import daycycle, metrics, scorer
from ..engine.context import FEATURES
from ..models import Tenant
from ..schemas import CompareIn, SimulateIn
from ..sim.behaviour import SimulationError, simulate
from ..sim.synthetic import DEMO_NAME, create_synthetic_tenant
from ..auth import Actor, admin_actor, require_admin_global
from .deps import get_tenant

router = APIRouter(tags=["insights"])


@router.get("/tenants/{tenant_id}/metrics", summary="Growth KPIs")
def kpis(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    return metrics.kpis(db, tenant)


@router.get("/tenants/{tenant_id}/metrics/funnel", summary="Activation funnel")
def funnel(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    return metrics.funnel(db, tenant)


@router.get("/tenants/{tenant_id}/metrics/timeseries", summary="Daily metric snapshots")
def timeseries(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    return metrics.timeseries(db, tenant)


@router.get("/tenants/{tenant_id}/graph", summary="Community growth graph (members, co-rides, social ties, referrals)")
def graph(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor), include_discovered: bool = False):
    return metrics.graph(db, tenant, include_discovered)


@router.get("/tenants/{tenant_id}/model", summary="Current propensity-model weights (learned online)")
def model(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    rows = scorer.tenant_weights(db, tenant)
    db.commit()
    return {r: {"weights": dict(zip(FEATURES, [round(w, 4) for w in s.weights])), "updates": s.updates}
            for r, s in rows.items()}


@router.post("/tenants/{tenant_id}/day/close", summary="Admin: close today: expire unmatched demand, snapshot metrics")
def close_day(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    snap = daycycle.close_day(db, tenant)
    db.commit()
    return {"closed_day": snap["day"], "metrics": snap, "current_day": tenant.current_day}


@router.post("/tenants/{tenant_id}/simulate", summary="Admin: replay N days on a SYNTHETIC community")
def run_simulation(body: SimulateIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    try:
        days = simulate(db, tenant, body.days, seed=body.seed, strategy=body.strategy, budget=body.budget,
                        connectors_first=body.connectors_first, referrals_on=body.referrals_on,
                        learning_on=body.learning_on)
    except SimulationError as e:
        raise HTTPException(409, str(e))
    return {"tenant_id": tenant.id, "current_day": tenant.current_day, "days": days,
            "kpis": metrics.kpis(db, tenant)}


@router.post("/demo/compare", summary="Smart engine vs random nudges on identical synthetic communities",
             dependencies=[Depends(require_admin_global)])
def compare(body: CompareIn, db: Session = Depends(get_db)):
    out = {}
    for strategy in ("smart", "random"):
        t = create_synthetic_tenant(db, name=f"{DEMO_NAME} ({strategy} run)", seed_active=body.seed_active)
        db.commit()
        simulate(db, t, body.days, strategy=strategy, budget=body.budget)
        out[strategy] = {"tenant_id": t.id, "kpis": metrics.kpis(db, t), "funnel": metrics.funnel(db, t),
                         "timeseries": [{"day": d["day"], "active_users": d["active_users"],
                                         "rides_completed_today": d["rides_completed_today"],
                                         "registered": d["registered"]} for d in metrics.timeseries(db, t)]}
    s, r = out["smart"]["kpis"], out["random"]["kpis"]
    out["lift"] = {k: (round(s[k] / r[k], 2) if r[k] else None)
                   for k in ("active_users", "rides_completed", "registered", "match_rate")}
    return out
