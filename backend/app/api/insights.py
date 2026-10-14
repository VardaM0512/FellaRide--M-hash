"""Metrics, funnel, growth graph, model weights, day clock and synthetic simulation."""
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings

from ..db import get_db
from ..engine import daycycle, metrics, scorer
from ..engine.context import FEATURES
from ..models import Tenant
from ..schemas import CompareIn, SimulateIn
from ..sim.behaviour import SimulationError, simulate
from ..sim.synthetic import create_synthetic_tenant
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


def _local_date(dt: datetime, tz: timezone):
    if dt.tzinfo is None:   # SQLite returns naive UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date()


@router.post("/cron/close-days", summary="Daily job (X-Admin-Key): close the day for every real community")
def cron_close_days(db: Session = Depends(get_db), x_admin_key: str | None = Header(default=None)):
    """Call once a day (GitHub Actions / cron-job.org). Brings each real community's engine day up to the number
    of calendar days since it was created, so a missed or repeated call is harmless. Synthetic demos are skipped."""
    key = get_settings().admin_key
    if not key:
        raise HTTPException(503, "Set FELLARIDE_ADMIN_KEY on the server to use the daily job.")
    if not (x_admin_key and hmac.compare_digest(x_admin_key, key)):
        raise HTTPException(401, "This action needs a valid X-Admin-Key header.")
    tz = timezone(timedelta(minutes=get_settings().utc_offset_min))
    today = datetime.now(tz).date()
    closed = {}
    for tenant in db.scalars(select(Tenant).where(Tenant.is_synthetic.is_(False))):
        target = (today - _local_date(tenant.created_at, tz)).days
        n = 0
        while tenant.current_day < target and n < 31:   # catch up at most a month per call
            daycycle.close_day(db, tenant)
            n += 1
        db.commit()
        if n:
            closed[tenant.id] = {"closed": n, "current_day": tenant.current_day}
    return {"date": today.isoformat(), "closed": closed}


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
        t = create_synthetic_tenant(db, name=f"Synthetic University ({strategy} run)", seed_active=body.seed_active)
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
