"""Growth metrics, activation funnel, growth graph and daily snapshots."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (Booking, Connection, DailyMetric, Event, Intervention, Member, MemberState, Referral,
                      RideFeedback, RideOffer, RideRequest, Tenant, Trip, TripSeat)

ACTIVE_WINDOW_DAYS = 7
SEAT_MATCHED = ("approved", "boarded", "dropped", "missed", "cancelled")   # app seat requests the driver accepted


def _ratio(a: float, b: float) -> float:
    return round(a / b, 4) if b else 0.0


def app_counts(db: Session, tenant_id: int) -> dict:
    """Ride counts from the member app (posted trips and seat requests) for one community."""
    trips = select(Trip.id).where(Trip.tenant_id == tenant_id)
    seats = select(func.count()).select_from(TripSeat).where(TripSeat.trip_id.in_(trips))
    carried = TripSeat.trip_id == Trip.id
    return {
        "rides_created": db.scalar(select(func.count()).select_from(Trip).where(Trip.tenant_id == tenant_id)) or 0,
        "rides_completed": db.scalar(select(func.count()).select_from(Trip).where(
            Trip.tenant_id == tenant_id, Trip.status == "completed",
            select(TripSeat.id).where(carried, TripSeat.status == "dropped").exists())) or 0,
        "rides_cancelled": db.scalar(select(func.count()).select_from(Trip).where(
            Trip.tenant_id == tenant_id, Trip.status == "cancelled")) or 0,
        "seat_requests": db.scalar(seats) or 0,
        "seats_matched": db.scalar(seats.where(TripSeat.status.in_(SEAT_MATCHED))) or 0,
        "riders_carried": db.scalar(seats.where(TripSeat.status == "dropped")) or 0,
    }


def kpis(db: Session, tenant: Tenant) -> dict:
    t, day = tenant.id, tenant.current_day
    members = list(db.scalars(select(Member).where(Member.tenant_id == t)))
    active = [m for m in members if m.last_ride_day is not None and m.last_ride_day >= day - ACTIVE_WINDOW_DAYS]
    riders = sum(1 for m in members if m.rides_count >= 1)
    repeaters = sum(1 for m in members if m.rides_count >= 2)

    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(model.tenant_id == t, *where)) or 0

    engine = {
        "rides_created": count(RideOffer),
        "rides_completed": count(RideOffer, RideOffer.status == "completed"),
        "rides_cancelled": count(RideOffer, RideOffer.status == "cancelled"),
        "seat_requests": count(RideRequest),
        "seats_matched": count(RideRequest, RideRequest.status.in_(("matched", "completed", "cancelled"))),
    }
    app = app_counts(db, t)
    # every ride counts once, wherever it was made: engine offers + member-app trips
    requests = engine["seat_requests"] + app["seat_requests"]
    matched = engine["seats_matched"] + app["seats_matched"]
    completed = engine["rides_completed"] + app["rides_completed"]
    cancelled = engine["rides_cancelled"] + app["rides_cancelled"]
    created = engine["rides_created"] + app["rides_created"]
    nudges7 = count(Intervention, Intervention.day >= day - ACTIVE_WINDOW_DAYS, Intervention.status != "sent")
    resp7 = count(Intervention, Intervention.day >= day - ACTIVE_WINDOW_DAYS, Intervention.status == "responded")
    refs = count(Referral)
    refs_won = count(Referral, Referral.status == "joined")
    partners: dict[int, set[int]] = {}
    for c in db.scalars(select(Connection).where(Connection.tenant_id == t, Connection.kind == "co_ride")):
        partners.setdefault(c.a_id, set()).add(c.b_id)
        partners.setdefault(c.b_id, set()).add(c.a_id)
    connectivity = sum(len(partners.get(m.id, ())) for m in active) / len(active) if active else 0.0
    ratings_count = count(RideFeedback)
    avg_rating = db.scalar(select(func.avg(RideFeedback.rating)).where(RideFeedback.tenant_id == t)) if ratings_count else None
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
        "ratings_count": ratings_count,
        "avg_rating": round(float(avg_rating), 2) if avg_rating is not None else None,
        "by_source": {"engine": engine, "app": app},
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
    # member-app rides finished on this engine day (written by the activation bridge)
    for p in db.scalars(select(Event.payload).where(Event.tenant_id == tenant.id, Event.day == tenant.current_day,
                                                    Event.type == "ride_completed")):
        if p.get("source") == "app":
            data["rides_completed_today"] += 1
            data["riders_seated_today"] += len(p.get("riders", []))
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
