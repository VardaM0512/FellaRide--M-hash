"""Interventions (nudges) and referrals."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..engine import interventions, referrals
from ..engine.context import build_context
from ..models import Intervention, Referral, Tenant
from ..schemas import PlanIn, ReferralIn, RespondIn
from .deps import get_tenant, member_in

router = APIRouter(tags=["engagement"])


def iv_out(iv: Intervention) -> dict:
    return {"id": iv.id, "member_id": iv.member_id, "day": iv.day, "kind": iv.kind, "strategy": iv.strategy,
            "message": iv.message, "suggested_member_id": iv.suggested_member_id, "priority": iv.priority,
            "status": iv.status}


@router.post("/tenants/{tenant_id}/interventions/plan",
             summary="Intervention engine: choose who gets which nudge today")
def plan(body: PlanIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    ivs = interventions.plan(db, build_context(db, tenant), tenant, body.budget, body.strategy, body.connectors_first)
    db.commit()
    return {"day": tenant.current_day, "count": len(ivs), "interventions": [iv_out(i) for i in ivs]}


@router.get("/tenants/{tenant_id}/interventions", summary="List interventions")
def list_ivs(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
             day: int | None = Query(None, ge=0), member_id: int | None = None,
             limit: int = Query(100, ge=1, le=500)):
    q = select(Intervention).where(Intervention.tenant_id == tenant.id)
    if day is not None:
        q = q.where(Intervention.day == day)
    if member_id is not None:
        q = q.where(Intervention.member_id == member_id)
    return [iv_out(i) for i in db.scalars(q.order_by(Intervention.id.desc()).limit(limit))]


@router.post("/tenants/{tenant_id}/interventions/{intervention_id}/respond",
             summary="Record a member's reaction to a nudge (the model learns from it)")
def respond(intervention_id: int, body: RespondIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    iv = db.get(Intervention, intervention_id)
    if not iv or iv.tenant_id != tenant.id:
        raise HTTPException(404, f"Intervention {intervention_id} not found in this community.")
    try:
        result = interventions.respond(db, tenant, iv, body.responded)
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return result


@router.get("/tenants/{tenant_id}/members/{member_id}/invite-suggestions",
            summary="Who this member should invite (most likely to participate)")
def invite_suggestions(member_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                       limit: int = Query(3, ge=1, le=10)):
    m = member_in(db, tenant, member_id)
    out = referrals.suggest_invitees(db, build_context(db, tenant), tenant, m, limit)
    db.commit()
    return out


@router.post("/tenants/{tenant_id}/referrals", status_code=201, summary="Send an invite")
def send(body: ReferralIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    inviter, invitee = member_in(db, tenant, body.inviter_id), member_in(db, tenant, body.invitee_id)
    try:
        r = referrals.send(db, tenant, inviter, invitee)
    except referrals.ReferralError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"id": r.id, "inviter_id": r.inviter_id, "invitee_id": r.invitee_id, "status": r.status, "day": r.day}


@router.post("/tenants/{tenant_id}/referrals/{referral_id}/accept", summary="Invitee accepts and joins")
def accept(referral_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    r = db.get(Referral, referral_id)
    if not r or r.tenant_id != tenant.id:
        raise HTTPException(404, f"Invite {referral_id} not found in this community.")
    try:
        referrals.accept(db, tenant, r)
    except referrals.ReferralError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"id": r.id, "status": r.status, "invitee_id": r.invitee_id}
