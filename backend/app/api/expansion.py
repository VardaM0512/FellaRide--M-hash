"""Network Expansion Engine: where to grow, which communities to link, and the actions it takes (organisers only)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Actor, admin_actor
from ..db import get_db
from ..engine import expansion, metrics
from ..engine.context import build_context
from ..models import Tenant
from ..schemas import AutopilotIn, CorridorIn, ExpansionRunIn
from ..sim.behaviour import SimulationError, simulate
from ..sim.synthetic import NEIGHBOUR_NAME, create_neighbour_tenant
from .deps import get_tenant

router = APIRouter(tags=["expansion"])


@router.get("/tenants/{tenant_id}/expansion",
            summary="Expansion report: diagnosis, growth areas with forecasts, linked communities, actions and what worked")
def report(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    out = expansion.report(db, tenant)
    db.commit()   # evaluating due actions is part of reading the report
    return out


@router.post("/tenants/{tenant_id}/expansion/run", summary="Run one expansion cycle: evaluate, analyse, act")
def run(body: ExpansionRunIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
        _: Actor | None = Depends(admin_actor)):
    out = expansion.run_cycle(db, tenant, body.max_actions)
    db.commit()
    return out


@router.post("/tenants/{tenant_id}/expansion/autopilot",
             summary="SYNTHETIC communities: replay days with the expansion engine acting every day")
def autopilot(body: AutopilotIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
              _: Actor | None = Depends(admin_actor)):
    try:
        days = simulate(db, tenant, body.days, seed=body.seed, expansion_autopilot=True)
    except SimulationError as e:
        raise HTTPException(409, str(e))
    return {"current_day": tenant.current_day, "actions_taken": sum(d.get("expansion_actions", 0) for d in days),
            "kpis": metrics.kpis(db, tenant)}


@router.post("/tenants/{tenant_id}/expansion/corridors", status_code=201,
             summary="Propose opening a shared corridor with another community")
def propose(body: CorridorIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
            _: Actor | None = Depends(admin_actor)):
    other = db.get(Tenant, body.community_id)
    if not other or other.id == tenant.id:
        raise HTTPException(404, "That community doesn't exist.")
    link = next((c for c in expansion.cross_community(db, tenant, build_context(db, tenant)) if c["community_id"] == other.id), None)
    corridor = next((c for c in (link or {}).get("shared_corridors", []) if c["id"] == body.corridor), None)
    if corridor is None:
        raise HTTPException(409, "There's no shared corridor with that community in that area any more.")
    a = expansion.propose_corridor(db, tenant, other, corridor)
    db.commit()
    return expansion.action_out(a)


@router.post("/tenants/{tenant_id}/expansion/demo-neighbour", status_code=201,
             summary="SYNTHETIC demo only: add a nearby synthetic community to link with")
def demo_neighbour(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    if not tenant.is_synthetic:
        raise HTTPException(409, "Only available in the synthetic demo community.")
    existing = db.scalar(select(Tenant).where(Tenant.name == NEIGHBOUR_NAME))
    if existing:
        return {"id": existing.id, "name": existing.name, "created": False}
    nb = create_neighbour_tenant(db, tenant)
    db.commit()
    simulate(db, nb, min(max(tenant.current_day, 5), 20))
    return {"id": nb.id, "name": nb.name, "created": True}
