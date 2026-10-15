"""Referrals: your personal code and link, the friends you brought in, points and tiers, and the organiser's view."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import Actor, admin_actor
from ..db import get_db
from ..engine import referral_program as R
from ..models import Referral, Tenant, User
from .trips import rider_or_driver

router = APIRouter(tags=["referrals"])


@router.get("/referral/{code}", summary="Public: whose referral code this is (first name and community only)")
def lookup(code: str, db: Session = Depends(get_db)):
    u = R.referrer_by_code(db, code)
    if u is None:
        raise HTTPException(404, "That referral code doesn't exist.")
    return {"code": code.strip().upper(), "referrer": R.first_name(db, u.id), "community": db.get(Tenant, u.tenant_id).name}


@router.get("/me/referrals", summary="Your referral code, the friends you brought in, points, tier and the top referrers")
def mine(user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    code = R.code_for(db, user)
    s = R.stats(db, user)
    pending = db.query(Referral).filter(Referral.inviter_id == user.member_id, Referral.status == "sent").count() \
        if user.member_id else 0
    out = {"code": code, "link_path": f"/signup?ref={code}", "community": db.get(Tenant, user.tenant_id).name,
           "points_per": {"joined": R.POINTS_JOINED, "first_ride": R.POINTS_FIRST_RIDE},
           "tiers": [{"name": n, "at": need} for need, n in R.TIERS], "invites_waiting": pending,
           "leaderboard": R.leaderboard(db, user.tenant_id), **s}
    db.commit()   # a new code is saved
    return out


@router.get("/tenants/{tenant_id}/referrals", summary="Organiser: people brought in by members, first rides, top referrers")
def organiser_view(tenant_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    return R.tenant_report(db, db.get(Tenant, tenant_id))
