"""Ride offers, requests, instant matching, start, completion and cancellation."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..auth import Actor, admin_actor, ensure_self, member_actor, self_member_id
from ..db import get_db
from ..engine import matching, rides
from ..engine.context import build_context
from ..models import Booking, Member, RideOffer, RideRequest, Tenant
from ..schemas import FinishIn, OfferIn, RequestIn
from .deps import get_tenant, member_in

router = APIRouter(tags=["rides"])


def _name(db: Session, member_id: int | None) -> str | None:
    m = db.get(Member, member_id) if member_id else None
    return m.name if m else None


def offer_out(db: Session, o: RideOffer, bookings: list[Booking]) -> dict:
    return {"id": o.id, "driver_id": o.driver_id, "driver_name": _name(db, o.driver_id),
            "destination_id": o.destination_id, "day": o.day,
            "depart_min": o.depart_min, "seats_total": o.seats_total, "seats_left": o.seats_left, "status": o.status,
            "riders": [{"booking_id": b.id, "rider_id": b.rider_id, "rider_name": _name(db, b.rider_id),
                        "match_score": b.score, "status": b.status} for b in bookings]}


def request_out(db: Session, q: RideRequest) -> dict:
    return {"id": q.id, "rider_id": q.rider_id, "rider_name": _name(db, q.rider_id), "day": q.day,
            "depart_min": q.depart_min, "status": q.status, "preferred_driver_id": q.preferred_driver_id,
            "preferred_driver_name": _name(db, q.preferred_driver_id)}


def _bookings(db: Session, offer_id: int) -> list[Booking]:
    return list(db.scalars(select(Booking).where(Booking.offer_id == offer_id)))


def _offer_in(db: Session, tenant: Tenant, offer_id: int) -> RideOffer:
    o = db.get(RideOffer, offer_id)
    if not o or o.tenant_id != tenant.id:
        raise HTTPException(404, f"Ride {offer_id} not found in this community.")
    return o


@router.post("/tenants/{tenant_id}/rides/offers", status_code=201,
             summary="Offer seats today (as yourself); waiting riders are matched straight away")
def offer(body: OfferIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
          actor: Actor = Depends(member_actor)):
    mid = body.member_id if body.member_id is not None else self_member_id(actor)
    ensure_self(actor, mid)
    m = member_in(db, tenant, mid)
    try:
        o = rides.create_offer(db, tenant, m, tenant.current_day, body.depart_min, body.seats)
    except rides.RideError as e:
        raise HTTPException(409, str(e))
    rides.match_now(db, tenant)
    db.commit()
    return offer_out(db, o, _bookings(db, o.id))


@router.post("/tenants/{tenant_id}/rides/requests", status_code=201,
             summary="Ask for a seat today (as yourself); matched straight away if a driver is going your way")
def request(body: RequestIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
            actor: Actor = Depends(member_actor)):
    mid = body.member_id if body.member_id is not None else self_member_id(actor)
    ensure_self(actor, mid)
    m = member_in(db, tenant, mid)
    if body.preferred_driver_id is not None:
        d = member_in(db, tenant, body.preferred_driver_id)
        if not d.has_car or d.id == m.id:
            raise HTTPException(422, "The driver you asked for doesn’t offer rides.")
    q = rides.create_request(db, tenant, m, tenant.current_day, body.depart_min, body.preferred_driver_id)
    rides.match_now(db, tenant)
    db.commit()
    db.refresh(q)
    return request_out(db, q)


@router.post("/tenants/{tenant_id}/rides/requests/{request_id}/cancel", summary="Withdraw your seat request")
def cancel_request(request_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                   actor: Actor = Depends(member_actor)):
    q = db.get(RideRequest, request_id)
    if not q or q.tenant_id != tenant.id:
        raise HTTPException(404, f"Request {request_id} not found in this community.")
    ensure_self(actor, q.rider_id)
    try:
        rides.cancel_request(db, tenant, q)
    except rides.RideError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return request_out(db, q)


@router.post("/tenants/{tenant_id}/rides/match", summary="Admin: run the matching engine for today")
def run_match(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    bookings = rides.match_now(db, tenant)
    db.commit()
    return {"day": tenant.current_day, "matched": len(bookings),
            "bookings": [{"id": b.id, "offer_id": b.offer_id, "driver_id": b.driver_id, "rider_id": b.rider_id,
                          "score": b.score} for b in bookings]}


@router.get("/tenants/{tenant_id}/rides", summary="Rides for a day (defaults to today). Members see only their own.")
def list_rides(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), actor: Actor = Depends(member_actor),
               day: int | None = Query(None, ge=0)):
    d = tenant.current_day if day is None else day
    offers_q = select(RideOffer).where(RideOffer.tenant_id == tenant.id, RideOffer.day == d)
    req_q = select(RideRequest).where(RideRequest.tenant_id == tenant.id, RideRequest.day == d)
    if not actor.is_admin:
        mid = self_member_id(actor)
        mine = select(Booking.offer_id).where(Booking.rider_id == mid)
        offers_q = offers_q.where(or_(RideOffer.driver_id == mid, RideOffer.id.in_(mine)))
        req_q = req_q.where(RideRequest.rider_id == mid)
    offers = list(db.scalars(offers_q))
    bmap: dict[int, list[Booking]] = {}
    for b in db.scalars(select(Booking).where(Booking.tenant_id == tenant.id, Booking.day == d)):
        bmap.setdefault(b.offer_id, []).append(b)
    requests = list(db.scalars(req_q))
    return {"day": d, "offers": [offer_out(db, o, bmap.get(o.id, [])) for o in offers],
            "requests": [request_out(db, q) for q in requests],
            "open_requests": [{"id": q.id, "rider_id": q.rider_id, "depart_min": q.depart_min} for q in requests if q.status == "open"]}


@router.post("/tenants/{tenant_id}/rides/offers/{offer_id}/start",
             summary="Driver sets off: matched riders get a 'ride started' message")
def start(offer_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
          actor: Actor = Depends(member_actor)):
    o = _offer_in(db, tenant, offer_id)
    ensure_self(actor, o.driver_id)
    try:
        rides.start_offer(db, tenant, o)
    except rides.RideError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return offer_out(db, o, _bookings(db, o.id))


@router.post("/tenants/{tenant_id}/rides/offers/{offer_id}/finish", summary="Driver marks the ride completed or cancelled")
def finish(offer_id: int, body: FinishIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
           actor: Actor = Depends(member_actor)):
    o = _offer_in(db, tenant, offer_id)
    ensure_self(actor, o.driver_id)
    try:
        rides.finish_offer(db, build_context(db, tenant), tenant, o, body.completed)
    except rides.RideError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return offer_out(db, o, _bookings(db, o.id))


# keep the import used (matching is re-exported for tests that call it directly)
_ = matching
