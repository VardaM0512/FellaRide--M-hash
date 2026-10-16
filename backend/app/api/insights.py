"""Metrics, funnel, growth graph, model weights, day clock and synthetic simulation."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..engine import daycycle, metrics, scorer
from ..engine import trips as T
from ..engine.context import FEATURES
from ..models import Event, Member, Tenant
from ..schemas import CompareIn, SimulateIn
from ..sim.behaviour import SimulationError, simulate
from ..sim.synthetic import DEMO_NAME, create_synthetic_tenant
from ..auth import Actor, admin_actor, require_admin_global
from .deps import get_tenant
from .social import CO2_KG_PER_KM, TREE_KG_PER_YEAR, _rides

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


# What the organiser's activity feed shows: milestones and outcomes, not the engine's bookkeeping (nudges sent,
# offers and requests opened, matches) which would bury them.
FEED_TYPES = ("member_registered", "first_ride", "repeat_ride", "first_referral_converted", "referral_joined",
              "ride_completed", "ride_cancelled", "trip_posted", "trip_unfilled", "ride_rated", "nudge_responded",
              "expansion_action", "corridor_proposed")


@router.get("/tenants/{tenant_id}/activity", summary="Organiser: what just happened in the community, newest first")
def activity(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor),
             limit: int = Query(40, ge=1, le=200)):
    rows = db.execute(select(Event, Member.name).outerjoin(Member, Member.id == Event.member_id)
                      .where(Event.tenant_id == tenant.id, Event.type.in_(FEED_TYPES))
                      .order_by(Event.id.desc()).limit(limit)).all()
    keep = ("via", "rating", "kind", "area", "how")
    return [{"id": e.id, "day": e.day, "type": e.type, "at": T.utc(e.created_at).isoformat(),
             "member": {"id": e.member_id, "name": name} if e.member_id else None,
             "source": (e.payload or {}).get("source", "engine"),
             "detail": {k: v for k, v in (e.payload or {}).items() if k in keep}} for e, name in rows]


@router.get("/tenants/{tenant_id}/impact", summary="Organiser: what sharing rides has saved: CO2, km, money, by day and by route")
def community_impact(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    rides = _rides(db, tenant)
    rates = T.current_rates(db, tenant.id)
    seat_km = sum(r.km * len(r.riders) for r in rides)
    people = {r.driver for r in rides} | {x for r in rides for x in r.riders}
    # day by day, running totals (every day up to today, so quiet days show as flat)
    per_day: dict[int, float] = {}
    for r in rides:
        per_day[r.day] = per_day.get(r.day, 0.0) + r.km * len(r.riders)
    running, series = 0.0, []
    for d in range(0, max([tenant.current_day, *per_day]) + 1):
        running += per_day.get(d, 0.0)
        series.append({"day": d, "co2_kg": round(running * CO2_KG_PER_KM, 1), "km": round(running)})
    # by route: the driver's neighbourhood to the destination
    drivers = {m.id: m for m in db.scalars(select(Member).where(Member.id.in_({r.driver for r in rides})))} if rides else {}
    routes: dict[tuple[str, str], dict] = {}
    for r in rides:
        m = drivers.get(r.driver)
        if not m:
            continue
        k = (m.area, m.destination.name if m.destination else "")
        row = routes.setdefault(k, {"from": k[0], "to": k[1], "rides": 0, "seats": 0, "km": 0.0})
        row["rides"] += 1
        row["seats"] += len(r.riders)
        row["km"] += r.km * len(r.riders)
    top = sorted(routes.values(), key=lambda x: -x["km"])[:6]
    return {
        "rides": len(rides), "seats": sum(len(r.riders) for r in rides), "people": len(people),
        "km_shared": round(seat_km), "co2_kg": round(seat_km * CO2_KG_PER_KM),
        "trees_year": round(seat_km * CO2_KG_PER_KM / TREE_KG_PER_YEAR, 1),
        "money_saved": round(seat_km * rates.car_cost_per_km),
        "series": series,
        "routes": [{**x, "km": round(x["km"]), "co2_kg": round(x["km"] * CO2_KG_PER_KM, 1)} for x in top],
        "assumptions": {"co2_kg_per_km": CO2_KG_PER_KM, "tree_kg_per_year": TREE_KG_PER_YEAR, "car_cost_per_km": rates.car_cost_per_km},
        "synthetic": tenant.is_synthetic,
    }


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
        t = create_synthetic_tenant(db, name=f"{DEMO_NAME.removesuffix(' (demo)')} ({strategy} run)", seed_active=body.seed_active)
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
