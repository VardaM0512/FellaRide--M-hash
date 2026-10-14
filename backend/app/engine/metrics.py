"""Growth metrics, activation funnel, growth graph and daily snapshots."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (Booking, Connection, DailyMetric, Intervention, Member, MemberState, Referral, RideOffer,
                      RideRequest, Tenant)

ACTIVE_WINDOW_DAYS = 7


def _ratio(a: float, b: float) -> float:
    return round(a / b, 4) if b else 0.0


def kpis(db: Session, tenant: Tenant) -> dict:
    t, day = tenant.id, tenant.current_day
    members = list(db.scalars(select(Member).where(Member.tenant_id == t)))
    active = [m for m in members if m.last_ride_day is not None and m.last_ride_day >= day - ACTIVE_WINDOW_DAYS]
    riders = sum(1 for m in members if m.rides_count >= 1)
    repeaters = sum(1 for m in members if m.rides_count >= 2)

    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(model.tenant_id == t, *where)) or 0

    requests = count(RideRequest)
    matched = count(RideRequest, RideRequest.status.in_(("matched", "completed", "cancelled")))
    completed = count(RideOffer, RideOffer.status == "completed")
    cancelled = count(RideOffer, RideOffer.status == "cancelled")
    created = count(RideOffer)
    nudges7 = count(Intervention, Intervention.day >= day - ACTIVE_WINDOW_DAYS, Intervention.status != "sent")
    resp7 = count(Intervention, Intervention.day >= day - ACTIVE_WINDOW_DAYS, Intervention.status == "responded")
    refs = count(Referral)
    refs_won = count(Referral, Referral.status == "joined")
    partners: dict[int, set[int]] = {}
    for c in db.scalars(select(Connection).where(Connection.tenant_id == t, Connection.kind == "co_ride")):
        partners.setdefault(c.a_id, set()).add(c.b_id)
        partners.setdefault(c.b_id, set()).add(c.a_id)
    connectivity = sum(len(partners.get(m.id, ())) for m in active) / len(active) if active else 0.0
    return {
        "day": day,
        "members_total": len(members),
        "registered": sum(1 for m in members if m.registered_day is not None),
        "active_users": len(active),
        "rides_created": created,
        "rides_completed": completed,
        "match_rate": _ratio(matched, requests),
        "completion_rate": _ratio(completed, completed + cancelled),
        "repeat_rate": _ratio(repeaters, riders),
        "avg_network_connectivity": round(connectivity, 3),
        "nudge_response_rate_7d": _ratio(resp7, nudges7),
        "referral_conversion": _ratio(refs_won, refs),
    }


def funnel(db: Session, tenant: Tenant) -> list[dict]:
    members = list(db.scalars(select(Member).where(Member.tenant_id == tenant.id)))
    steps = [
        ("discovered", len(members)),
        ("registered", sum(1 for m in members if m.registered_day is not None)),
        ("first_interaction", sum(1 for m in members if m.interacted_day is not None)),
        ("first_ride", sum(1 for m in members if m.first_ride_day is not None)),
        ("repeat_ride", sum(1 for m in members if m.repeat_day is not None)),
        ("referral", sum(1 for m in members if m.referrer_day is not None)),
    ]
    out = []
    for i, (name, n) in enumerate(steps):
        prev = steps[i - 1][1] if i else None
        out.append({"step": name, "count": n, "conversion_from_previous": _ratio(n, prev) if prev else None})
    return out


def graph(db: Session, tenant: Tenant, include_discovered: bool = False) -> dict:
    members = list(db.scalars(select(Member).where(Member.tenant_id == tenant.id)))
    keep = {m.id for m in members if include_discovered or m.state != MemberState.DISCOVERED}
    nodes = [{"id": m.id, "name": m.name, "state": m.state, "has_car": m.has_car, "connector": m.is_connector,
              "lat": m.home_lat, "lon": m.home_lon, "rides": m.rides_count} for m in members if m.id in keep]
    edges = [{"source": c.a_id, "target": c.b_id, "kind": c.kind, "weight": c.weight, "since_day": c.since_day}
             for c in db.scalars(select(Connection).where(Connection.tenant_id == tenant.id))
             if c.a_id in keep and c.b_id in keep]
    edges += [{"source": r.inviter_id, "target": r.invitee_id, "kind": "referral", "weight": 1, "since_day": r.day}
              for r in db.scalars(select(Referral).where(Referral.tenant_id == tenant.id, Referral.status == "joined"))]
    return {"nodes": nodes, "edges": edges}


def snapshot(db: Session, tenant: Tenant) -> DailyMetric:
    data = kpis(db, tenant)
    data["rides_completed_today"] = db.scalar(select(func.count()).select_from(RideOffer).where(
        RideOffer.tenant_id == tenant.id, RideOffer.day == tenant.current_day, RideOffer.status == "completed")) or 0
    data["riders_seated_today"] = db.scalar(select(func.count()).select_from(Booking).where(
        Booking.tenant_id == tenant.id, Booking.day == tenant.current_day, Booking.status == "completed")) or 0
    row = db.scalar(select(DailyMetric).where(DailyMetric.tenant_id == tenant.id, DailyMetric.day == tenant.current_day))
    if row:
        row.data = data
    else:
        row = DailyMetric(tenant_id=tenant.id, day=tenant.current_day, data=data)
        db.add(row)
    db.flush()
    return row


def timeseries(db: Session, tenant: Tenant) -> list[dict]:
    rows = db.scalars(select(DailyMetric).where(DailyMetric.tenant_id == tenant.id).order_by(DailyMetric.day))
    return [r.data for r in rows]
