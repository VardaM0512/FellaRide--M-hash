"""Intervention Engine: decides who gets which action, and when.

Smart strategy priority = p_role x corridor value x (1 - fatigue) x relevance boost.
  - connectors first (days 0-4): ask hubs to invite neighbours who commute like them
  - likely drivers: "N people from your community head to X around 08:05. Offer a ride?"
  - likely riders:  "Varun drives your way at 08:04. Share your morning commute?"
                    or, with no driver yet, "N people from your community commute this way."
Random strategy = baseline for comparison: generic message to random eligible members.
Rules: at most one action per member every `nudge_cooldown_days`; daily budget caps the total.
"""
import random
from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Alert, Event, Intervention, Member, Referral, Tenant, User
from . import lifecycle, notify, rides, scorer
from .context import Context, is_registered
from .matching import match_score


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _eligible(m: Member, day: int, cooldown: int) -> bool:
    return is_registered(m) and (m.last_nudged_day is None or day - m.last_nudged_day >= cooldown)


def plan(db: Session, ctx: Context, tenant: Tenant, budget: int | None = None, strategy: str = "smart",
         connectors_first: bool = True, rng: random.Random | None = None) -> list[Intervention]:
    s = get_settings()
    budget = budget or s.nudge_budget_per_day
    rng = rng or random.Random()
    day = ctx.day
    already = set(db.scalars(select(Intervention.member_id).where(Intervention.tenant_id == tenant.id,
                                                                  Intervention.day == day)))
    pool = [m for m in ctx.members.values() if _eligible(m, day, s.nudge_cooldown_days) and m.id not in already]
    weights = scorer.tenant_weights(db, tenant)
    chosen: list[tuple[float, Member, str, str, int | None]] = []   # (priority, member, kind, message, suggested)

    if strategy == "random":
        rng.shuffle(pool)
        for m in pool[:budget]:
            chosen.append((0.0, m, "generic", "Try FellaRide for your commute this week!", None))
    else:
        sent = Counter(dict(db.execute(select(Referral.inviter_id, func.count()).where(Referral.tenant_id == tenant.id)
                                       .group_by(Referral.inviter_id)).all()))
        registered = [m for m in ctx.members.values() if is_registered(m)]
        drivers = [m for m in registered if m.has_car]
        riders = [m for m in registered if not m.has_car]
        for m in pool:
            x = ctx.features(m)
            sc = scorer.score_member(weights, x)
            c = ctx.corridor(m.id)
            fatigue = min(0.6, m.nudges_received * 0.08)
            dest = ctx.destinations[m.destination_id].name
            if connectors_first and day <= 4 and m.is_connector and sent[m.id] < 3:
                msg = f"Invite neighbours who commute like you: {len(c.member_ids)} people around {c.area or 'you'} could join."
                chosen.append((2 + sc["connector"], m, "connector", msg, None))
            elif m.has_car:
                n = sum(1 for r in riders if match_score(ctx, m, r))
                pri = sc["driver"] * c.value * (1 - fatigue) * (1.4 if n else 0.5)
                msg = (f"{n} people from your community head to {dest} around {hhmm(m.depart_min)}. Offer a ride?"
                       if n else f"Offer your {hhmm(m.depart_min)} drive to {dest}?")
                chosen.append((pri, m, "driver", msg, None))
            else:
                best = max(((d, match_score(ctx, d, m)) for d in drivers), key=lambda t: t[1].score if t[1] else -1,
                           default=(None, None))
                if best[1]:
                    d = best[0]
                    pri = sc["rider"] * c.value * (1 - fatigue) * 1.4
                    msg = f"{d.name} drives your way at {hhmm(d.depart_min)}. Share your morning commute?"
                    chosen.append((pri, m, "rider", msg, d.id))
                else:
                    pri = sc["rider"] * c.value * (1 - fatigue) * 0.4
                    msg = f"{max(c.registered, 2)} people from your community commute this way. Join their ride group?"
                    chosen.append((pri, m, "rider", msg, None))
        chosen.sort(key=lambda t: t[0], reverse=True)
        chosen = chosen[:budget]

    out = [deliver(db, ctx, tenant, m, kind, msg, suggested, pri, strategy) for pri, m, kind, msg, suggested in chosen]
    db.flush()
    return out


NUDGE_TITLE = {"driver": "Offer a ride today?", "rider": "A ride on your route", "connector": "Invite your neighbours"}


def deliver(db: Session, ctx: Context, tenant: Tenant, m: Member, kind: str, msg: str, suggested: int | None,
            priority: float, strategy: str) -> Intervention:
    """Send one nudge: record it, count it against the member's fatigue, notify them, and show it in the app."""
    day = ctx.day
    role = {"driver": "driver", "rider": "rider", "connector": "connector"}.get(kind, "driver" if m.has_car else "rider")
    iv = Intervention(tenant_id=tenant.id, member_id=m.id, day=day, kind=kind, role=role, strategy=strategy,
                      message=msg, suggested_member_id=suggested, priority=round(priority, 4), features=ctx.features(m))
    m.nudges_received += 1
    m.last_nudged_day = day
    db.add(iv)
    db.add(Event(tenant_id=tenant.id, member_id=m.id, day=day, type="nudge_sent", payload={"kind": kind, "strategy": strategy}))
    title = NUDGE_TITLE.get(kind, "Try FellaRide this week")
    notify.send(db, tenant, m.id, "nudge", title, msg)
    # members who use the app see the nudge in Alerts, with a button to act on it
    user_id = db.scalar(select(User.id).where(User.member_id == m.id))
    if user_id:
        db.add(Alert(user_id=user_id, kind=f"nudge_{kind}", title=title, body=msg))
    return iv


def eligible(m: Member, day: int) -> bool:
    """Joined, and not nudged within the cooldown."""
    return _eligible(m, day, get_settings().nudge_cooldown_days)


def respond(db: Session, tenant: Tenant, iv: Intervention, responded: bool, learn: bool = True,
            follow_up: bool = True) -> dict:
    """Record the member's reaction, learn from it, and take the follow-up action.
    follow_up=False: the member already acted in the app (posted a ride or asked for a seat), so no engine
    offer or request is created; the answer is only recorded and learned from."""
    if iv.status != "sent":
        raise ValueError(f"Intervention {iv.id} was already answered ({iv.status}).")
    m = db.get(Member, iv.member_id)
    iv.status = "responded" if responded else "ignored"
    if learn:
        weights = scorer.tenant_weights(db, tenant)
        scorer.learn(weights[iv.role], iv.features, 1 if responded else 0, get_settings().learning_rate)
    db.add(Event(tenant_id=tenant.id, member_id=m.id, day=iv.day, type="nudge_" + iv.status, payload={"id": iv.id}))
    result: dict = {"intervention_id": iv.id, "status": iv.status, "offer_id": None, "request_id": None}
    if not responded or not follow_up:
        if responded:
            m.nudges_responded += 1
            lifecycle.mark_interacted(db, m, iv.day, "nudge")
        db.flush()
        return result
    m.nudges_responded += 1
    lifecycle.mark_interacted(db, m, iv.day, "nudge")
    if iv.kind == "driver" or (iv.kind == "generic" and m.has_car and m.seats > 0):
        result["offer_id"] = rides.create_offer(db, tenant, m, iv.day).id
    elif iv.kind in ("rider", "generic"):
        result["request_id"] = rides.create_request(db, tenant, m, iv.day, preferred_driver_id=iv.suggested_member_id).id
    db.flush()
    return result
