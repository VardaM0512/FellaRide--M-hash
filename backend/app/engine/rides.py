"""Ride Service: create offers/requests, complete or cancel rides, grow the co-ride graph,
and feed match outcomes back into the scorer (successful matches teach, failed ones too)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Booking, Connection, Event, Member, RideOffer, RideRequest, Tenant
from . import lifecycle, notify, scorer
from .context import Context, build_context


class RideError(ValueError):
    pass


def create_offer(db: Session, tenant: Tenant, driver: Member, day: int, depart_min: int | None = None,
                 seats: int | None = None) -> RideOffer:
    if not driver.has_car or driver.seats <= 0:
        raise RideError("Only members with a car and free seats can offer a ride.")
    existing = db.scalar(select(RideOffer).where(RideOffer.driver_id == driver.id, RideOffer.day == day,
                                                 RideOffer.status.in_(("open", "full"))))
    if existing:
        return existing
    seats = min(seats or driver.seats, driver.seats)
    o = RideOffer(tenant_id=tenant.id, driver_id=driver.id, destination_id=driver.destination_id, day=day,
                  depart_min=depart_min if depart_min is not None else driver.depart_min,
                  seats_total=seats, seats_left=seats)
    db.add(o)
    lifecycle.mark_interacted(db, driver, day, "offered_ride")
    db.add(Event(tenant_id=tenant.id, member_id=driver.id, day=day, type="ride_offered", payload={"seats": seats}))
    db.flush()
    return o


def create_request(db: Session, tenant: Tenant, rider: Member, day: int, depart_min: int | None = None,
                   preferred_driver_id: int | None = None) -> RideRequest:
    existing = db.scalar(select(RideRequest).where(RideRequest.rider_id == rider.id, RideRequest.day == day,
                                                   RideRequest.status.in_(("open", "matched"))))
    if existing:
        if existing.status == "open" and preferred_driver_id and not existing.preferred_driver_id:
            existing.preferred_driver_id = preferred_driver_id
        return existing
    q = RideRequest(tenant_id=tenant.id, rider_id=rider.id, destination_id=rider.destination_id, day=day,
                    depart_min=depart_min if depart_min is not None else rider.depart_min,
                    preferred_driver_id=preferred_driver_id)
    db.add(q)
    lifecycle.mark_interacted(db, rider, day, "requested_ride")
    db.add(Event(tenant_id=tenant.id, member_id=rider.id, day=day, type="ride_requested", payload={}))
    db.flush()
    return q


def _link(db: Session, tenant_id: int, a: int, b: int, day: int) -> None:
    a, b = min(a, b), max(a, b)
    c = db.scalar(select(Connection).where(Connection.a_id == a, Connection.b_id == b, Connection.kind == "co_ride"))
    if c:
        c.weight += 1
    else:
        db.add(Connection(tenant_id=tenant_id, a_id=a, b_id=b, kind="co_ride", since_day=day))


def finish_offer(db: Session, ctx: Context | None, tenant: Tenant, offer: RideOffer, completed: bool,
                 learn: bool = True) -> list[Booking]:
    """Close a ride. Completed rides advance everyone's lifecycle and add co-ride edges."""
    if offer.status in ("completed", "cancelled"):
        raise RideError(f"Ride {offer.id} is already {offer.status}.")
    bookings = list(db.scalars(select(Booking).where(Booking.offer_id == offer.id, Booking.status == "booked")))
    if not bookings:
        offer.status = "unfilled"
        db.flush()
        return []
    offer.status = "completed" if completed else "cancelled"
    day = offer.day
    driver_m = db.get(Member, offer.driver_id)
    weights = scorer.tenant_weights(db, tenant) if learn and ctx else None
    lr = get_settings().learning_rate
    if offer.status == "completed":
        driver = db.get(Member, offer.driver_id)
        lifecycle.mark_ride_completed(db, driver, day)
        riders = []
        for b in bookings:
            b.status = "completed"
            rider = db.get(Member, b.rider_id)
            riders.append(rider)
            lifecycle.mark_ride_completed(db, rider, day)
            db.get(RideRequest, b.request_id).status = "completed"
            _link(db, tenant.id, driver.id, rider.id, day)
            notify.send(db, tenant, rider.id, "rate_ride", f"How was your ride with {driver.name}?",
                        "Rate the ride. It helps us match you better.", offer.id, b.id)
            notify.send(db, tenant, driver.id, "rate_ride", f"How was the ride with {rider.name}?",
                        "Rate the ride. It helps us match you better.", offer.id, b.id)
            if weights:   # a successful match is a positive example for the rider model
                scorer.learn(weights["rider"], ctx.features(rider), 1, lr, 0.5)
        for i, r1 in enumerate(riders):
            for r2 in riders[i + 1:]:
                _link(db, tenant.id, r1.id, r2.id, day)
        db.add(Event(tenant_id=tenant.id, member_id=driver.id, day=day, type="ride_completed",
                     payload={"offer_id": offer.id, "riders": [r.id for r in riders]}))
    else:
        for b in bookings:
            b.status = "cancelled"
            db.get(RideRequest, b.request_id).status = "cancelled"
            notify.send(db, tenant, b.rider_id, "ride_cancelled", f"{driver_m.name} cancelled today’s ride",
                        "Ask for a seat again and we’ll look for another driver.", offer.id, b.id)
            if weights:   # a failed match is a weak negative example
                scorer.learn(weights["rider"], ctx.features(db.get(Member, b.rider_id)), 0, lr, 0.25)
        db.add(Event(tenant_id=tenant.id, member_id=offer.driver_id, day=day, type="ride_cancelled",
                     payload={"offer_id": offer.id}))
    db.flush()
    return bookings


def expire_unmatched(db: Session, tenant: Tenant, day: int) -> None:
    for q in db.scalars(select(RideRequest).where(RideRequest.tenant_id == tenant.id, RideRequest.day == day,
                                                  RideRequest.status == "open")):
        q.status = "expired"
        notify.send(db, tenant, q.rider_id, "no_match", "No match today",
                    "Nobody was driving your way at your time. We’ll keep looking tomorrow.")
    for o in db.scalars(select(RideOffer).where(RideOffer.tenant_id == tenant.id, RideOffer.day == day,
                                                RideOffer.status == "open", RideOffer.seats_left == RideOffer.seats_total)):
        o.status = "unfilled"   # nobody booked; not counted against completion rate


def start_offer(db: Session, tenant: Tenant, offer: RideOffer) -> RideOffer:
    """Driver sets off: every seated rider gets a "your ride has started" message."""
    if offer.status not in ("open", "full"):
        raise RideError(f"Ride {offer.id} can't be started: it is {offer.status}.")
    bookings = list(db.scalars(select(Booking).where(Booking.offer_id == offer.id, Booking.status == "booked")))
    if not bookings:
        raise RideError("Nobody is matched to this ride yet, so there is no one to pick up.")
    offer.status = "started"
    driver = db.get(Member, offer.driver_id)
    for b in bookings:
        notify.send(db, tenant, b.rider_id, "ride_started", f"{driver.name} has started the ride",
                    f"{notify.first(driver.name)} is on the way to pick you up. Be ready at {notify.hhmm(offer.depart_min)}.",
                    offer.id, b.id)
    db.add(Event(tenant_id=tenant.id, member_id=driver.id, day=offer.day, type="ride_started", payload={"offer_id": offer.id}))
    db.flush()
    return offer


def cancel_request(db: Session, tenant: Tenant, q: RideRequest) -> RideRequest:
    if q.status != "open":
        raise RideError("Only a request that hasn’t been matched yet can be withdrawn.")
    q.status = "cancelled"
    db.flush()
    return q


def match_now(db: Session, tenant: Tenant) -> list[Booking]:
    """Run matching immediately after new supply or demand, so nobody waits for an operator.
    Riders still unmatched afterwards: ask the driver they wanted (or the best compatible drivers
    who aren't offering yet) to offer seats."""
    from .matching import match_score, run_matching   # local import: matching imports notify only

    ctx = build_context(db, tenant)
    day = tenant.current_day
    bookings = run_matching(db, ctx, tenant, day)
    offering = set(db.scalars(select(RideOffer.driver_id).where(
        RideOffer.tenant_id == tenant.id, RideOffer.day == day, RideOffer.status.in_(("open", "full", "started")))))
    for q in db.scalars(select(RideRequest).where(RideRequest.tenant_id == tenant.id, RideRequest.day == day,
                                                  RideRequest.status == "open")):
        rider = ctx.members[q.rider_id]
        candidates = []
        if q.preferred_driver_id and q.preferred_driver_id not in offering:
            candidates = [ctx.members[q.preferred_driver_id]]
        else:
            ranked = []
            for d in ctx.members.values():
                if d.has_car and d.seats > 0 and d.id not in offering and d.state != "discovered":
                    r = match_score(ctx, d, rider, d.depart_min, q.depart_min)
                    if r:
                        ranked.append((r.score, d))
            candidates = [d for _, d in sorted(ranked, key=lambda t: t[0], reverse=True)[:3]]
        for d in candidates:
            notify.send(db, tenant, d.id, "seat_wanted", f"{rider.name} wants a seat on your {notify.hhmm(d.depart_min)} drive",
                        f"{notify.first(rider.name)} lives in {rider.area} and goes your way. Offer seats to be matched.",
                        once_per_day=True)
    db.flush()
    return bookings
