"""Referral programme: every member has a personal code (shared as a sign-up link), new accounts made through it
or through an email invite are credited to the person who brought them, and the referrer earns points as each
friend joins and takes a first ride. Tiers count friends who actually rode, so fake sign-ups earn little.

The engine side (funnel, referrer state, growth graph) is updated through activation.credit_referral."""
import secrets

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from ..auth import is_deleted
from ..models import AppReferral, Profile, Referral, ReferralCode, Tenant, Trip, TripSeat, User
from . import activation
from .trips import RODE, alert

POINTS_JOINED = 10        # a friend signs up through you
POINTS_FIRST_RIDE = 40    # ... and takes their first shared ride
TIERS = [(0, "Starter"), (1, "Bronze"), (3, "Silver"), (10, "Gold")]   # friends who took a first ride
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O or 1/I, easy to read out loud


def code_for(db: Session, user: User) -> str:
    """Your referral code, made on first use: up to 6 letters of your first name plus 4 random characters."""
    row = db.get(ReferralCode, user.id)
    if row:
        return row.code
    p = db.get(Profile, user.id)
    stem = "".join(c for c in (p.name.split()[0] if p and p.name else "") if c.isascii() and c.isalpha()).upper()[:6] or "RIDE"
    while True:
        code = stem + "".join(secrets.choice(_ALPHABET) for _ in range(4))
        if not db.scalar(select(ReferralCode.user_id).where(ReferralCode.code == code)):
            break
    db.add(ReferralCode(user_id=user.id, code=code))
    db.flush()
    return code


def referrer_by_code(db: Session, code: str | None) -> User | None:
    """The member a code belongs to (never an organiser or a deleted account)."""
    if not code:
        return None
    u = db.scalar(select(User).join(ReferralCode, ReferralCode.user_id == User.id).where(ReferralCode.code == code.strip().upper()))
    return u if u and u.role == "member" and not is_deleted(u) else None


def first_name(db: Session, user_id: int) -> str:
    p = db.get(Profile, user_id)
    return (p.name.split()[0] if p and p.name else "A friend")[:40]


def record(db: Session, referrer: User, referred: User, source: str) -> AppReferral | None:
    """Credit `referrer` for bringing in `referred` (same community, once per new account)."""
    if referrer.id == referred.id or referrer.tenant_id != referred.tenant_id:
        return None
    if db.scalar(select(AppReferral.id).where(AppReferral.referred_user_id == referred.id)):
        return None
    r = AppReferral(tenant_id=referred.tenant_id, referrer_user_id=referrer.id, referred_user_id=referred.id, source=source)
    db.add(r)
    alert(db, referrer.id, "referral_joined", f"{first_name(db, referred.id)} joined with your invite",
          f"+{POINTS_JOINED} points. You get +{POINTS_FIRST_RIDE} more when they take their first shared ride.")
    db.flush()
    if source == "link":   # an email invite already converted on the engine side when they signed up
        activation.safe(db, activation.credit_referral, referrer, referred)
    return r


def credit_email_invite(db: Session, user: User) -> None:
    """After sign-up: if an email invite converted for this person, credit the member who sent it."""
    if not user.member_id:
        return
    ref = db.scalar(select(Referral).where(Referral.invitee_id == user.member_id, Referral.status == "joined"))
    inviter = db.scalar(select(User).where(User.member_id == ref.inviter_id)) if ref else None
    if inviter:
        record(db, inviter, user, "invite")


def has_ridden(db: Session, user_id: int) -> bool:
    """Took at least one shared ride: as a rider who got in, or as the driver of a ride with someone on board."""
    as_rider = exists().where(TripSeat.rider_id == user_id, TripSeat.status.in_(RODE), TripSeat.trip_id == Trip.id,
                              or_(TripSeat.status == "dropped", Trip.status == "completed"))
    as_driver = exists().where(Trip.driver_id == user_id, Trip.status == "completed", TripSeat.trip_id == Trip.id,
                               TripSeat.status.in_(RODE))
    return bool(db.scalar(select(or_(as_rider, as_driver))))


def tier_for(rode: int) -> dict:
    name = next(n for need, n in reversed(TIERS) if rode >= need)
    nxt = next(((need, n) for need, n in TIERS if need > rode), None)
    return {"name": name, "next": nxt[1] if nxt else None, "next_at": nxt[0] if nxt else None}


def stats(db: Session, user: User) -> dict:
    rows = list(db.scalars(select(AppReferral).where(AppReferral.referrer_user_id == user.id).order_by(AppReferral.id.desc())))
    friends = []
    for r in rows:
        rode = has_ridden(db, r.referred_user_id)
        friends.append({"name": first_name(db, r.referred_user_id), "source": r.source,
                        "stage": "rode" if rode else "joined", "joined_at": r.created_at.isoformat()})
    rode = sum(f["stage"] == "rode" for f in friends)
    return {"joined": len(friends), "rode": rode, "points": POINTS_JOINED * len(friends) + POINTS_FIRST_RIDE * rode,
            "tier": tier_for(rode), "friends": friends}


def leaderboard(db: Session, tenant_id: int, limit: int = 5) -> list[dict]:
    """Top referrers in a community, by friends brought in."""
    q = (select(AppReferral.referrer_user_id, func.count(AppReferral.id).label("n"))
         .where(AppReferral.tenant_id == tenant_id).group_by(AppReferral.referrer_user_id)
         .order_by(func.count(AppReferral.id).desc(), AppReferral.referrer_user_id).limit(limit))
    out = []
    for uid, n in db.execute(q).all():
        u = db.get(User, uid)
        if u and not is_deleted(u):
            out.append({"user_id": uid, "name": first_name(db, uid), "joined": n})
    return out


def tenant_report(db: Session, tenant: Tenant) -> dict:
    """For the organiser: how many people came in through members, how many rode, who brings people in."""
    rows = list(db.scalars(select(AppReferral).where(AppReferral.tenant_id == tenant.id)))
    rode = sum(has_ridden(db, r.referred_user_id) for r in rows)
    members = db.scalar(select(func.count(User.id)).where(User.tenant_id == tenant.id, User.role == "member")) or 0
    return {"joined": len(rows), "rode": rode, "by_link": sum(r.source == "link" for r in rows),
            "by_invite": sum(r.source == "invite" for r in rows),
            "share_of_members": round(len(rows) / members, 3) if members else 0.0,
            "first_ride_rate": round(rode / len(rows), 3) if rows else 0.0,
            "top": leaderboard(db, tenant.id, 5)}
