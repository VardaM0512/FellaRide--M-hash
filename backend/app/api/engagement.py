"""Interventions (nudges / suggestions) and referrals (invites)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Actor, admin_actor, ensure_self, member_actor, self_member_id
from ..db import get_db
from ..engine import interventions, referrals, rides
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
             summary="Admin: intervention engine chooses who gets which nudge today")
def plan(body: PlanIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
         _: Actor | None = Depends(admin_actor)):
    ivs = interventions.plan(db, build_context(db, tenant), tenant, body.budget, body.strategy, body.connectors_first)
    db.commit()
    return {"day": tenant.current_day, "count": len(ivs), "interventions": [iv_out(i) for i in ivs]}


@router.get("/tenants/{tenant_id}/interventions", summary="List suggestions (members see only their own)")
def list_ivs(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), actor: Actor = Depends(member_actor),
             day: int | None = Query(None, ge=0), member_id: int | None = None,
             limit: int = Query(100, ge=1, le=500)):
    if not actor.is_admin:
        member_id = self_member_id(actor)
    q = select(Intervention).where(Intervention.tenant_id == tenant.id)
    if day is not None:
        q = q.where(Intervention.day == day)
    if member_id is not None:
        q = q.where(Intervention.member_id == member_id)
    return [iv_out(i) for i in db.scalars(q.order_by(Intervention.id.desc()).limit(limit))]


@router.post("/tenants/{tenant_id}/interventions/{intervention_id}/respond",
             summary="Answer your suggestion (the model learns from it); a yes is matched straight away")
def respond(intervention_id: int, body: RespondIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
            actor: Actor = Depends(member_actor)):
    iv = db.get(Intervention, intervention_id)
    if not iv or iv.tenant_id != tenant.id:
        raise HTTPException(404, f"Suggestion {intervention_id} not found in this community.")
    ensure_self(actor, iv.member_id)
    try:
        result = interventions.respond(db, tenant, iv, body.responded)
    except ValueError as e:
        raise HTTPException(409, str(e))
    result["matched"] = 0
    if result.get("offer_id") or result.get("request_id"):
        result["matched"] = len(rides.match_now(db, tenant))
    db.commit()
    return result


@router.get("/tenants/{tenant_id}/members/{member_id}/invite-suggestions",
            summary="Who you should invite (most likely to participate)")
def invite_suggestions(member_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                       actor: Actor = Depends(member_actor), limit: int = Query(3, ge=1, le=10)):
    ensure_self(actor, member_id)
    m = member_in(db, tenant, member_id)
    out = referrals.suggest_invitees(db, build_context(db, tenant), tenant, m, limit)
    db.commit()
    return out


def ref_out(r: Referral, db: Session) -> dict:
    from ..models import Member
    invitee = db.get(Member, r.invitee_id)
    return {"id": r.id, "inviter_id": r.inviter_id, "invitee_id": r.invitee_id, "invitee_name": invitee.name if invitee else None,
            "status": r.status, "day": r.day}


@router.get("/tenants/{tenant_id}/me/referrals", summary="Invites I have sent")
def my_referrals(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), actor: Actor = Depends(member_actor)):
    mid = self_member_id(actor)
    return [ref_out(r, db) for r in db.scalars(select(Referral).where(
        Referral.tenant_id == tenant.id, Referral.inviter_id == mid).order_by(Referral.id.desc()).limit(50))]


@router.post("/tenants/{tenant_id}/referrals", status_code=201, summary="Send an invite (as yourself)")
def send(body: ReferralIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
         actor: Actor = Depends(member_actor)):
    inviter_id = body.inviter_id if body.inviter_id is not None else self_member_id(actor)
    ensure_self(actor, inviter_id)
    inviter, invitee = member_in(db, tenant, inviter_id), member_in(db, tenant, body.invitee_id)
    try:
        r = referrals.send(db, tenant, inviter, invitee)
    except referrals.ReferralError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return ref_out(r, db)


@router.post("/tenants/{tenant_id}/referrals/{referral_id}/accept",
             summary="Invitee joins (admin; or, in a synthetic demo community, the inviter simulating it)")
def accept(referral_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
           actor: Actor = Depends(member_actor)):
    r = db.get(Referral, referral_id)
    if not r or r.tenant_id != tenant.id:
        raise HTTPException(404, f"Invite {referral_id} not found in this community.")
    if not (actor.is_admin or (tenant.is_synthetic and actor.member_id == r.inviter_id)):
        raise HTTPException(403, "Only the person invited can accept this invite.")
    try:
        referrals.accept(db, tenant, r)
    except referrals.ReferralError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return ref_out(r, db)
