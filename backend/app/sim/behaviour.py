"""Day-by-day replay of a SYNTHETIC community, driven entirely through the real engine services.

Only this module reads SyntheticTrait (the members' hidden willingness to drive, ride, refer and
respond). The engine never sees those values: it has to learn them from outcomes, as it would
with real people. Same probabilities as the FellaRide Growth Simulator page.
"""
import random

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engine import daycycle, interventions, lifecycle, matching, referrals, rides
from ..engine.context import build_context
from ..models import Booking, Member, MemberState, RideOffer, SyntheticTrait, Tenant


class SimulationError(ValueError):
    pass


def _traits(db: Session, tenant: Tenant) -> dict[int, SyntheticTrait]:
    q = select(SyntheticTrait).join(Member, Member.id == SyntheticTrait.member_id).where(Member.tenant_id == tenant.id)
    return {t.member_id: t for t in db.scalars(q)}


def simulate_day(db: Session, tenant: Tenant, rng: random.Random, traits: dict[int, SyntheticTrait],
                 strategy: str = "smart", budget: int = 14, connectors_first: bool = True,
                 referrals_on: bool = True, learning_on: bool = True) -> dict:
    day = tenant.current_day
    ctx = build_context(db, tenant)
    summary = {"day": day, "joined_organic": 0, "nudges": 0, "responded": 0, "offers": 0, "requests": 0,
               "matched": 0, "rides_completed": 0, "rides_cancelled": 0, "referrals_sent": 0, "referrals_joined": 0}

    # Discover: a trickle of organic signups from public signals
    for m in ctx.members.values():
        if m.state == MemberState.DISCOVERED and rng.random() < 0.004:
            lifecycle.mark_registered(db, m, day, via="public_signal")
            summary["joined_organic"] += 1
    ctx = build_context(db, tenant)

    # Identify + Nudge
    for iv in interventions.plan(db, ctx, tenant, budget=budget, strategy=strategy,
                                 connectors_first=connectors_first, rng=rng):
        m, tr = ctx.members[iv.member_id], traits[iv.member_id]
        if iv.kind == "driver":
            relevance = 0.4 if iv.message.startswith("Offer your") else 1.0
            p = min(0.95, tr.responsiveness * tr.t_drive * relevance * 1.4)
        elif iv.kind == "rider":
            p = tr.responsiveness * tr.t_ride * (1.0 if iv.suggested_member_id else 0.45)
        elif iv.kind == "connector":
            p = tr.responsiveness * tr.t_refer * 1.1
        else:   # generic baseline message
            p = tr.responsiveness * (tr.t_drive if m.has_car else tr.t_ride) * 0.35
        ok = rng.random() < p
        interventions.respond(db, tenant, iv, ok, learn=learning_on)
        summary["nudges"] += 1
        summary["responded"] += ok
        if ok and iv.kind == "connector":
            ties = [ctx.members[t] for t in ctx.ties.get(m.id, ()) if ctx.members[t].state == MemberState.DISCOVERED]
            ties.sort(key=lambda t: traits[t.id].t_ride, reverse=True)
            for t in ties[:3]:
                ref = referrals.send(db, tenant, m, t, source="connector")
                summary["referrals_sent"] += 1
                if rng.random() < 0.55:
                    referrals.accept(db, tenant, ref)
                    summary["referrals_joined"] += 1

    # Habitual demand: members who already interacted post rides on their own
    for m in ctx.members.values():
        if m.interacted_day is None:
            continue
        tr = traits[m.id]
        habit = 0.72 if m.rides_count > 0 else 0.22
        if m.has_car and m.seats > 0:
            if rng.random() < min(0.95, habit * tr.t_drive * 1.35):
                rides.create_offer(db, tenant, m, day)
        elif rng.random() < habit * tr.t_ride:
            rides.create_request(db, tenant, m, day)

    # Match
    bookings = matching.run_matching(db, ctx, tenant, day)
    summary["matched"] = len(bookings)

    # Ride: better matches complete more often
    offers = list(db.scalars(select(RideOffer).where(RideOffer.tenant_id == tenant.id, RideOffer.day == day,
                                                     RideOffer.status.in_(("open", "full")))))
    summary["offers"] = len(offers)
    for o in offers:
        bs = list(db.scalars(select(Booking).where(Booking.offer_id == o.id, Booking.status == "booked")))
        if not bs:
            continue
        q = sum(b.score for b in bs) / len(bs)
        done = rng.random() < 0.72 + 0.25 * q
        rides.finish_offer(db, ctx, tenant, o, done, learn=learning_on)
        summary["rides_completed" if done else "rides_cancelled"] += 1

    # Refer: recently active repeat riders invite the engine's top suggested contact
    if referrals_on:
        ctx = build_context(db, tenant)
        for m in list(ctx.members.values()):
            if m.rides_count < 2 or m.last_ride_day is None or m.last_ride_day < day - 3:
                continue
            if rng.random() > traits[m.id].t_refer * 0.8:
                continue
            sugg = referrals.suggest_invitees(db, ctx, tenant, m, limit=1)
            if not sugg:
                continue
            t = ctx.members[sugg[0]["member_id"]]
            ref = referrals.send(db, tenant, m, t)
            summary["referrals_sent"] += 1
            conv = 0.38 * (1.5 if sugg[0]["hot_corridor"] else 0.8) * (0.5 + traits[t.id].t_ride)
            if rng.random() < conv:
                referrals.accept(db, tenant, ref)
                summary["referrals_joined"] += 1

    # Grow: close the day and snapshot metrics
    summary["metrics"] = daycycle.close_day(db, tenant)
    return summary


def simulate(db: Session, tenant: Tenant, days: int, seed: int = 11, **options) -> list[dict]:
    if not tenant.is_synthetic:
        raise SimulationError("Simulation only runs on synthetic demo communities, never on real members.")
    rng = random.Random(seed + tenant.current_day)
    traits = _traits(db, tenant)
    out = []
    for _ in range(days):
        out.append(simulate_day(db, tenant, rng, traits, **options))
        db.commit()
    return out

