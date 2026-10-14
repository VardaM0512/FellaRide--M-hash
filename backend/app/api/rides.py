"""Ride offers, requests, matching and completion."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..engine import matching, rides
from ..engine.context import build_context
from ..models import Booking, RideOffer, RideRequest, Tenant
from ..schemas import FinishIn, OfferIn, RequestIn
from .deps import get_tenant, member_in

router = APIRouter(tags=["rides"])


def offer_out(o: RideOffer, bookings: list[Booking]) -> dict:
    return {"id": o.id, "driver_id": o.driver_id, "destination_id": o.destination_id, "day": o.day,
            "depart_min": o.depart_min, "seats_total": o.seats_total, "seats_left": o.seats_left, "status": o.status,
            "riders": [{"rider_id": b.rider_id, "match_score": b.score, "status": b.status} for b in bookings]}


@router.post("/tenants/{tenant_id}/rides/offers", status_code=201, summary="Driver offers a ride today")
def offer(body: OfferIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    m = member_in(db, tenant, body.member_id)
    try:
        o = rides.create_offer(db, tenant, m, tenant.current_day, body.depart_min, body.seats)
    except rides.RideError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return offer_out(o, [])


@router.post("/tenants/{tenant_id}/rides/requests", status_code=201, summary="Passenger requests a ride today")
def request(body: RequestIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    m = member_in(db, tenant, body.member_id)
    q = rides.create_request(db, tenant, m, tenant.current_day, body.depart_min)
    db.commit()
    return {"id": q.id, "rider_id": q.rider_id, "day": q.day, "depart_min": q.depart_min, "status": q.status}


@router.post("/tenants/{tenant_id}/rides/match", summary="Run the matching engine for today")
def run_match(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    ctx = build_context(db, tenant)
    bookings = matching.run_matching(db, ctx, tenant, tenant.current_day)
    db.commit()
    return {"day": tenant.current_day, "matched": len(bookings),
            "bookings": [{"id": b.id, "offer_id": b.offer_id, "driver_id": b.driver_id, "rider_id": b.rider_id,
                          "score": b.score} for b in bookings]}


@router.get("/tenants/{tenant_id}/rides", summary="Rides for a day (defaults to today)")
def list_rides(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
               day: int | None = Query(None, ge=0)):
    d = tenant.current_day if day is None else day
    offers = list(db.scalars(select(RideOffer).where(RideOffer.tenant_id == tenant.id, RideOffer.day == d)))
    bmap: dict[int, list[Booking]] = {}
    for b in db.scalars(select(Booking).where(Booking.tenant_id == tenant.id, Booking.day == d)):
        bmap.setdefault(b.offer_id, []).append(b)
    open_requests = db.scalars(select(RideRequest).where(RideRequest.tenant_id == tenant.id, RideRequest.day == d,
                                                         RideRequest.status == "open"))
    return {"day": d, "offers": [offer_out(o, bmap.get(o.id, [])) for o in offers],
            "open_requests": [{"id": q.id, "rider_id": q.rider_id, "depart_min": q.depart_min} for q in open_requests]}


@router.post("/tenants/{tenant_id}/rides/offers/{offer_id}/finish", summary="Mark a ride completed or cancelled")
def finish(offer_id: int, body: FinishIn, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    o = db.get(RideOffer, offer_id)
    if not o or o.tenant_id != tenant.id:
        raise HTTPException(404, f"Ride {offer_id} not found in this community.")
    try:
        bookings = rides.finish_offer(db, build_context(db, tenant), tenant, o, body.completed)
    except rides.RideError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return offer_out(o, bookings)
