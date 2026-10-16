"""Rides on the road right now, for the organiser's live board.

Real communities: member-app rides that have set off, or leave within LEAVING_SOON, with the driver's latest
live position when they share it. A synthetic demo community has nobody actually driving, so the board replays
the latest day's completed engine rides on a loop: each car leaves the driver's home, picks its riders up nearest
first and drives on to their destination. Those rides are marked simulated wherever they're shown.
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Booking, Destination, Member, RideOffer, Tenant, Trip, TripLocation
from . import trips as T
from .geo import haversine_km

LEAVING_SOON = timedelta(minutes=30)
LOOP_S = 600            # a simulated ride takes this long, then starts again
ARRIVED_S = 45          # ...after standing at the destination for this long
SIM_RIDES = 8


def _place(name: str, lat: float, lon: float) -> dict:
    return {"name": name, "lat": lat, "lon": lon}


def app_rides(db: Session, tenant: Tenant, now: datetime) -> list[dict]:
    trips = db.scalars(select(Trip).where(Trip.tenant_id == tenant.id, (Trip.status == "started") | (
        (Trip.status == "open") & Trip.depart_at.between(now - timedelta(minutes=10), now + LEAVING_SOON))).order_by(Trip.depart_at))
    out = []
    for t in trips:
        seats = [s for s in T.seats(db, t) if s.status in ("approved", "boarded", "dropped")]
        loc = db.get(TripLocation, (t.id, t.driver_id))
        age = (now - T.utc(loc.updated_at)).total_seconds() if loc else None
        started = t.status == "started"
        out.append({
            "id": f"trip-{t.id}", "kind": "app", "status": "on_the_way" if started else "leaving",
            "driver": {"name": T.person(db, t.driver_id)["name"]},
            "riders": [{"name": T.person(db, s.rider_id)["name"], "lat": s.pickup_lat, "lon": s.pickup_lon,
                        "on_board": s.status in ("boarded", "dropped")} for s in seats if s.pickup_lat is not None],
            "from": _place(t.from_name, t.from_lat, t.from_lon), "to": _place(t.to_name, t.to_lat, t.to_lon),
            "path": t.route, "waypoints": None,
            "started_at": T.utc(t.started_at or t.depart_at).isoformat(), "duration_s": max(60, t.route_min * 60),
            "live": {"lat": loc.lat, "lon": loc.lon, "age_s": round(age)} if loc and age is not None and age < 300 else None,
            "seats_total": t.seats_total,
        })
    return out


def _pickup_order(start: Member, riders: list[Member]) -> list[Member]:
    """Nearest rider first, then the nearest to them, and so on."""
    left, at, order = list(riders), (start.home_lat, start.home_lon), []
    while left:
        nxt = min(left, key=lambda m: haversine_km(at[0], at[1], m.home_lat, m.home_lon))
        order.append(nxt)
        left.remove(nxt)
        at = (nxt.home_lat, nxt.home_lon)
    return order


def simulated_rides(db: Session, tenant: Tenant, now: datetime) -> tuple[int | None, list[dict]]:
    """The most recent completed engine rides (going back day by day until there are SIM_RIDES), on a loop."""
    by_offer: dict[int, list[int]] = {}
    day = None
    for b in db.scalars(select(Booking).where(Booking.tenant_id == tenant.id, Booking.status == "completed")
                        .order_by(Booking.day.desc(), Booking.offer_id).limit(SIM_RIDES * 6)):
        if b.offer_id not in by_offer and len(by_offer) >= SIM_RIDES:
            continue
        by_offer.setdefault(b.offer_id, []).append(b.rider_id)
        day = b.day   # the oldest day used
    if not by_offer:
        return None, []
    offer_ids = sorted(by_offer)
    offers = {o.id: o for o in db.scalars(select(RideOffer).where(RideOffer.id.in_(offer_ids)))}
    ids = {offers[i].driver_id for i in offer_ids} | {r for i in offer_ids for r in by_offer[i]}
    members = {m.id: m for m in db.scalars(select(Member).where(Member.id.in_(ids)))}
    clock = now.timestamp()
    out = []
    for i, oid in enumerate(offer_ids):
        o = offers[oid]
        driver, dest = members[o.driver_id], db.get(Destination, o.destination_id)
        riders = _pickup_order(driver, [members[r] for r in by_offer[oid] if r in members])
        offset = i * LOOP_S / max(1, len(offer_ids))                     # stagger, so cars are always on the road
        elapsed = (clock - offset) % LOOP_S
        out.append({
            "id": f"sim-{oid}", "kind": "simulated", "status": "on_the_way",
            "driver": {"name": driver.name},
            "riders": [{"name": r.name, "lat": r.home_lat, "lon": r.home_lon, "on_board": False} for r in riders],
            "from": _place(driver.area, driver.home_lat, driver.home_lon), "to": _place(dest.name, dest.lat, dest.lon),
            "path": None,
            "waypoints": [[driver.home_lat, driver.home_lon], *[[r.home_lat, r.home_lon] for r in riders], [dest.lat, dest.lon]],
            "started_at": (now - timedelta(seconds=elapsed)).isoformat(), "duration_s": LOOP_S - ARRIVED_S,
            "live": None, "seats_total": o.seats_total,
        })
    return day, out


def live(db: Session, tenant: Tenant) -> dict:
    now = T.now()
    rides = app_rides(db, tenant, now)
    source_day, sim = simulated_rides(db, tenant, now) if tenant.is_synthetic else (None, [])
    return {"server_now": now.isoformat(), "simulated": bool(sim), "source_day": source_day, "loop_s": LOOP_S,
            "rides": rides + sim}
