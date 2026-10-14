"""Referral mechanism: active members invite the people most likely to participate.

Candidates are the inviter's social ties who have not joined yet, ranked by predicted rider
propensity, with a bonus when they live in a hot corridor (they would get matched fast).
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Event, Member, MemberState, Referral, Tenant
from . import lifecycle, scorer
from .context import Context


class ReferralError(ValueError):
    pass


def suggest_invitees(db: Session, ctx: Context, tenant: Tenant, inviter: Member, limit: int = 3) -> list[dict]:
    weights = scorer.tenant_weights(db, tenant)
    already = set(db.scalars(select(Referral.invitee_id).where(Referral.inviter_id == inviter.id)))
    out = []
    for tid in ctx.ties.get(inviter.id, ()):
        t = ctx.members[tid]
        if t.state != MemberState.DISCOVERED or t.id in already:
            continue
        p = scorer.predict(weights["rider"].weights, ctx.features(t))
        hot = ctx.corridor(t.id).hot
        out.append({"member_id": t.id, "name": t.name, "area": t.area, "rider_propensity": round(p, 3),
                    "hot_corridor": hot, "rank_score": round(p + (0.5 if hot else 0), 3)})
    out.sort(key=lambda d: d["rank_score"], reverse=True)
    return out[:limit]


def send(db: Session, tenant: Tenant, inviter: Member, invitee: Member, source: str = "referral") -> Referral:
    if inviter.tenant_id != tenant.id or invitee.tenant_id != tenant.id:
        raise ReferralError("Both members must belong to this community.")
    if inviter.id == invitee.id:
        raise ReferralError("A member cannot invite themselves.")
    if invitee.state != MemberState.DISCOVERED:
        raise ReferralError(f"{invitee.name} is already a member.")
    if inviter.state == MemberState.DISCOVERED:
        raise ReferralError("Only registered members can send invites.")
    dup = db.scalar(select(Referral).where(Referral.inviter_id == inviter.id, Referral.invitee_id == invitee.id))
    if dup:
        return dup
    r = Referral(tenant_id=tenant.id, inviter_id=inviter.id, invitee_id=invitee.id, day=tenant.current_day,
                 source=source)
    db.add(r)
    db.add(Event(tenant_id=tenant.id, member_id=inviter.id, day=tenant.current_day, type="referral_sent",
                 payload={"invitee_id": invitee.id}))
    db.flush()
    return r


def accept(db: Session, tenant: Tenant, ref: Referral) -> Referral:
    if ref.status != "sent":
        raise ReferralError(f"Invite {ref.id} is already {ref.status}.")
    invitee, inviter = db.get(Member, ref.invitee_id), db.get(Member, ref.inviter_id)
    ref.status = "joined"
    day = tenant.current_day
    invitee.invited_by_id = inviter.id
    lifecycle.mark_registered(db, invitee, day, via="referral")
    lifecycle.mark_referrer(db, inviter, day)
    db.flush()
    return ref
