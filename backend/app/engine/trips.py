"""Trips: a driver posts a ride, riders nearby ask for a seat, the driver approves, everyone shares a boarding
code, the driver marks who got in, and the ride ends from either side.

Rules worth knowing:
- Proximity: a trip is "near you" when your last known location is within NEAR_KM of any point on its route.
  Searches match riders whose pickup AND drop are both close to the route, in that order.
- Ending: the driver can end the whole trip at any time. A rider ends only their own part; if they were the
  last rider still on board (or still to be picked up), the whole trip ends with them.
- Leaving early: if the driver set off more than EARLY_GRACE_MIN before the planned time and an approved rider
  never got in, the driver gets an automatic 1-star rating. Cancelling after approving riders gives 2 stars.
- Ratings: a person's rating is a recency-weighted average of their last RATING_WINDOW ratings
  (each older rating counts RECENCY times the one after it), so recent behaviour matters most.
"""
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from ..models import (Alert, Car, DriverLicence, PayoutInfo, Profile, Rating, Report, SeatPayment, Trip, TripLocation, TripMessage,
                      TripPrice, TripSeat, TripSeatCount, User)
from . import activation, pricing
from .geo import haversine_km

NEAR_KM = 2.5            # "near you" alerts and search radius around the route
EARLY_GRACE_MIN = 5
STALE_AFTER = timedelta(hours=3)   # an open trip this long past its time is expired
CANCEL_CUTOFF = timedelta(minutes=10)   # after a seat is confirmed, either side may cancel until this long before departure
TRACK_FROM = timedelta(minutes=30)      # live tracking starts this long before departure (or when the driver sets off)
TRACK_FRESH = timedelta(minutes=2)      # an older position is not shown as live
AVG_CITY_KMH = 22                       # for a rough "arriving in" when the phone doesn't report a speed
RATING_WINDOW = 20
RECENCY = 0.85

ON_TRIP = ("approved", "boarded")            # counts against seats and keeps the trip alive
RODE = ("boarded", "dropped")                 # actually travelled together
IN_GROUP = ("approved", "boarded", "dropped", "missed")   # sees the code, chat, phone numbers

# Report reasons (multiple choice). Each maps to a category; a report's category is its most serious one.
REPORT_REASONS: dict[str, tuple[str, str]] = {
    "unsafe_driving": ("safety", "Unsafe or rash driving"),
    "harassment": ("safety", "Harassment or inappropriate behaviour"),
    "intoxicated": ("safety", "Seemed drunk or intoxicated"),
    "felt_unsafe": ("safety", "Made me feel unsafe"),
    "asked_money": ("fraud", "Asked for more than the agreed contribution"),
    "didnt_pay": ("reliability", "Didn't pay the agreed contribution"),
    "fake_profile": ("fraud", "Fake profile or a different person"),
    "no_show": ("reliability", "Didn't show up"),
    "left_early": ("reliability", "Left early or without me"),
    "late": ("reliability", "Very late"),
    "cancelled_last_minute": ("reliability", "Cancelled at the last minute"),
    "wrong_route": ("reliability", "Took a very different route"),
    "rude": ("conduct", "Rude or abusive"),
    "smoking": ("conduct", "Smoking in the car"),
    "dirty_car": ("conduct", "Car was dirty"),
    "other": ("other", "Something else"),
}
CATEGORY_ORDER = ["safety", "fraud", "reliability", "conduct", "other"]
SEVERITY = {"safety": "high", "fraud": "medium", "reliability": "medium", "conduct": "low", "other": "low"}


class TripError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def now() -> datetime:
    return datetime.now(timezone.utc)


def utc(dt: datetime | None) -> datetime | None:
    """SQLite hands datetimes back without a zone; everything is stored in UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def leaves_in(dt: datetime) -> str:
    mins = int((utc(dt) - now()).total_seconds() // 60)
    if mins <= 1:
        return "leaving now"
    if mins < 90:
        return f"leaves in {mins} min"
    return f"leaves in about {round(mins / 60)} h"


# ---------- people ----------
# ---------- read cache while building ride details ----------
# Showing a ride looks up the same small rows many times (seat counts, price, payments, profiles, ratings), and each
# lookup is a round trip to the database (~70 ms to Supabase). While trip_out / search / a list of rides is being
# built (read-only, after any changes were committed), these lookups are remembered for that one request only.
def _cached(db: Session, key: tuple, fn):
    memo = db.info.get("trip_memo")
    if memo is None:
        return fn()
    if key not in memo:
        memo[key] = fn()
    return memo[key]


class read_cache:
    """with read_cache(db): ... remembers lookups for the block (nested blocks share the outer one)."""

    def __init__(self, db: Session):
        self.db, self.own = db, False

    def __enter__(self):
        if "trip_memo" not in self.db.info:
            self.db.info["trip_memo"], self.own = {}, True
        return self

    def __exit__(self, *exc):
        if self.own:
            self.db.info.pop("trip_memo", None)
        return False


def rating_of(db: Session, user_id: int) -> dict:
    return _cached(db, ("rating", user_id), lambda: _rating_of(db, user_id))


def _rating_of(db: Session, user_id: int) -> dict:
    # the latest RATING_WINDOW ratings and the overall count, in one round trip
    rows = db.execute(select(Rating.stars, func.count().over().label("total")).where(Rating.to_id == user_id)
                      .order_by(Rating.id.desc()).limit(RATING_WINDOW)).all()
    if not rows:
        return {"average": None, "count": 0}
    stars = [r.stars for r in rows]
    weights = [RECENCY ** i for i in range(len(stars))]
    avg = sum(s * w for s, w in zip(stars, weights)) / sum(weights)
    return {"average": round(avg, 2), "count": rows[0].total}


def profile(db: Session, user_id: int) -> Profile:
    p = db.get(Profile, user_id)
    if not p:
        raise TripError(409, "Add your name, gender and mobile number first.")
    return p


def person(db: Session, user_id: int, show_mobile: bool = False) -> dict:
    p = db.get(Profile, user_id)
    out = {"id": user_id, "name": p.name if p else "Member", "gender": p.gender if p else "unsaid",
           "rating": rating_of(db, user_id)}
    if show_mobile:
        out["mobile"] = p.mobile if p else None
    return out


def car_of(db: Session, user_id: int, show_plate: bool = False) -> dict | None:
    """The driver's car. Model and colour help riders choose a ride; the number plate is for finding the right
    car at pickup, so like the mobile number it is shown only to the driver and approved riders."""
    c = _cached(db, ("car", user_id), lambda: db.get(Car, user_id))
    if not c:
        return None
    return {"model": c.model, "colour": c.colour, "plate": c.plate if show_plate else None}


def save_car(db: Session, user_id: int, model: str, colour: str, plate: str) -> Car:
    c = db.get(Car, user_id) or Car(user_id=user_id)
    c.model, c.colour = model.strip(), colour.strip()
    c.plate = " ".join(plate.upper().replace("-", " ").split())   # "ka-01-ab-1234" -> "KA 01 AB 1234"
    db.add(c)
    return c


def car_words(car: dict | None) -> str:
    """'White Maruti Swift (KA 01 AB 1234)' for alerts; empty when the driver hasn't added a car."""
    if not car:
        return ""
    return f"{car['colour']} {car['model']}" + (f" ({car['plate']})" if car.get("plate") else "")


def alert(db: Session, user_id: int, kind: str, title: str, body: str = "", trip_id: int | None = None) -> None:
    db.add(Alert(user_id=user_id, kind=kind, title=title[:160], body=body[:400], trip_id=trip_id))


# ---------- reading trips ----------
def expire_stale(db: Session) -> None:
    db.execute(update(Trip).where(Trip.status == "open", Trip.depart_at < now() - STALE_AFTER).values(status="expired")
               .execution_options(synchronize_session="fetch"))


# ---------- concurrency: one change to a ride's seats at a time ----------
# Two approvals of the last seat (a double tap, or the driver on two devices) or a rider approved by two drivers
# at the same instant could otherwise both pass their "is there room / is the rider free" check. Every action that
# changes seats first locks the ride's row (SELECT ... FOR UPDATE); approving also locks the rider. Locks are always
# taken in the same order (ride, then rider) and held until the request commits, so two requests can never wait on
# each other (no deadlock). SQLite, used in tests and local dev, already runs one write at a time and ignores this.
def lock_trip(db: Session, trip: Trip) -> Trip:
    return db.scalars(select(Trip).where(Trip.id == trip.id).with_for_update().execution_options(populate_existing=True)).one()


def lock_rider(db: Session, user_id: int) -> None:
    db.scalars(select(Profile).where(Profile.user_id == user_id).with_for_update()).first()


def get_trip(db: Session, tenant_id: int, trip_id: int) -> Trip:
    t = db.get(Trip, trip_id)
    if not t or t.tenant_id != tenant_id:
        raise TripError(404, "That ride doesn't exist or has been removed.")
    return t


def seats(db: Session, trip: Trip) -> list[TripSeat]:
    return _cached(db, ("seats", trip.id), lambda: _seats(db, trip))


def _seats(db: Session, trip: Trip) -> list[TripSeat]:
    rows = _seats_query(db, trip)
    memo = db.info.get("trip_memo")
    if memo is not None and rows:   # showing a ride: load its seat counts, payments and people in one go each
        ids = [x.id for x in rows]
        counts = {c.seat_id: c for c in db.scalars(select(TripSeatCount).where(TripSeatCount.seat_id.in_(ids)))}
        pays = {p.seat_id: p for p in db.scalars(select(SeatPayment).where(SeatPayment.seat_id.in_(ids)))}
        for i in ids:
            memo.setdefault(("seat_count", i), counts.get(i))
            memo.setdefault(("payment", i), pays.get(i))
        list(db.scalars(select(Profile).where(Profile.user_id.in_([x.rider_id for x in rows] + [trip.driver_id]))))
    return rows


def _seats_query(db: Session, trip: Trip) -> list[TripSeat]:
    return list(db.scalars(select(TripSeat).where(TripSeat.trip_id == trip.id).order_by(TripSeat.id)))


def seat_of(db: Session, trip: Trip, user_id: int) -> TripSeat | None:
    return _cached(db, ("seat_of", trip.id, user_id), lambda: _seat_of(db, trip, user_id))


def _seat_of(db: Session, trip: Trip, user_id: int) -> TripSeat | None:
    return db.scalar(select(TripSeat).where(TripSeat.trip_id == trip.id, TripSeat.rider_id == user_id))


def seat_count(db: Session, seat: TripSeat) -> int:
    """How many seats this request is for (1 unless the rider booked for friends too)."""
    c = _cached(db, ("seat_count", seat.id), lambda: db.get(TripSeatCount, seat.id))
    return c.count if c else 1


def set_seat_count(db: Session, seat: TripSeat, count: int) -> None:
    c = db.get(TripSeatCount, seat.id)
    if count == 1 and not c:
        return
    if c:
        c.count = count
    else:
        db.add(TripSeatCount(seat_id=seat.id, count=count))


def seats_word(n: int) -> str:
    return f"{n} seat{'s' if n != 1 else ''}"


def seats_left(db: Session, trip: Trip) -> int:
    return _cached(db, ("seats_left", trip.id), lambda: _seats_left(db, trip))


def _seats_left(db: Session, trip: Trip) -> int:
    taken = db.scalar(
        select(func.coalesce(func.sum(func.coalesce(TripSeatCount.count, 1)), 0))
        .select_from(TripSeat).outerjoin(TripSeatCount, TripSeatCount.seat_id == TripSeat.id)
        .where(TripSeat.trip_id == trip.id, TripSeat.status.in_(ON_TRIP + ("dropped",))))
    return max(0, trip.seats_total - int(taken or 0))


# ---------- cost sharing (see pricing.py) ----------
def per_km_of(db: Session, trip: Trip) -> float:
    row = _cached(db, ("price", trip.id), lambda: db.get(TripPrice, trip.id))
    return row.per_km if row else pricing.default_per_km(trip.seats_total)


def contribution(db: Session, trip: Trip, rider_km: float, count: int = 1) -> int:
    return count * pricing.per_seat(per_km_of(db, trip), rider_km, trip.route_km, trip.seats_total)


def seat_km(trip: Trip, s: TripSeat) -> float:
    return pricing.along_route_km(trip.route, s.pickup_lat, s.pickup_lon)


def seat_contribution(db: Session, trip: Trip, s: TripSeat) -> int:
    return contribution(db, trip, seat_km(trip, s), seat_count(db, s))


def payment_of(db: Session, s: TripSeat) -> dict:
    p = _cached(db, ("payment", s.id), lambda: db.get(SeatPayment, s.id))
    return {"rider_paid": bool(p and p.rider_paid_at), "driver_got": bool(p and p.driver_got_at)}


def upi_of(db: Session, user_id: int) -> str | None:
    row = _cached(db, ("upi", user_id), lambda: db.get(PayoutInfo, user_id))
    return row.upi_id if row else None


def save_upi(db: Session, user_id: int, upi_id: str) -> None:
    row = db.get(PayoutInfo, user_id)
    if not upi_id:
        if row:
            db.delete(row)
        return
    if row:
        row.upi_id = upi_id
    else:
        db.add(PayoutInfo(user_id=user_id, upi_id=upi_id))


def price_out(db: Session, trip: Trip) -> dict:
    r = per_km_of(db, trip)
    return {"per_km": r, "free": r <= 0, "suggested_per_km": pricing.default_per_km(trip.seats_total),
            "max_per_km": pricing.max_per_km(trip.seats_total), "trip_cost": pricing.trip_cost(trip.route_km),
            "full_route_per_seat": contribution(db, trip, trip.route_km)}


def in_group(db: Session, trip: Trip, user_id: int) -> bool:
    if trip.driver_id == user_id:
        return True
    s = seat_of(db, trip, user_id)
    return bool(s and s.status in IN_GROUP)


def trip_out(db: Session, trip: Trip, viewer_id: int, extra: dict | None = None) -> dict:
    with read_cache(db):
        return _trip_out(db, trip, viewer_id, extra)


def _trip_out(db: Session, trip: Trip, viewer_id: int, extra: dict | None = None) -> dict:
    is_driver = trip.driver_id == viewer_id
    mine = None if is_driver else seat_of(db, trip, viewer_id)
    member = is_driver or bool(mine and mine.status in IN_GROUP)
    rider_rows = []
    for s in seats(db, trip):
        if is_driver:
            visible = s.status not in ("withdrawn",)
        else:   # riders see the others in the car, never other people's requests
            visible = member and s.status in IN_GROUP
        if visible:
            rider_rows.append({"seat_id": s.id, "status": s.status, "pickup_name": s.pickup_name, "seats": seat_count(db, s),
                               "contribution": seat_contribution(db, trip, s), "payment": payment_of(db, s),
                               "person": person(db, s.rider_id, show_mobile=is_driver and s.status in IN_GROUP)})
    return {
        "id": trip.id, "status": trip.status,
        "from": {"name": trip.from_name, "lat": trip.from_lat, "lon": trip.from_lon},
        "to": {"name": trip.to_name, "lat": trip.to_lat, "lon": trip.to_lon},
        "depart_at": utc(trip.depart_at).isoformat(), "started_at": utc(trip.started_at).isoformat() if trip.started_at else None,
        "route": trip.route, "route_km": trip.route_km, "route_min": trip.route_min,
        "seats_total": trip.seats_total, "seats_left": seats_left(db, trip),
        "driver": person(db, trip.driver_id, show_mobile=bool(mine and mine.status in ON_TRIP)),
        "car": car_of(db, trip.driver_id, show_plate=member),
        "you": "driver" if is_driver else "rider" if mine else "none",
        "my_seat": {"id": mine.id, "status": mine.status, "seats": seat_count(db, mine), "contribution": seat_contribution(db, trip, mine),
                    "payment": payment_of(db, mine)} if mine else None,
        "price": price_out(db, trip),
        "pay_to": _pay_to(db, trip, mine),
        "code": trip.code if member else None,
        "riders": rider_rows,
        "cancel_until": utc(trip.depart_at - CANCEL_CUTOFF).isoformat(),
        "can_cancel": can_cancel(db, trip, viewer_id),
        "tracking": tracking_window(trip),
        "live": live_positions(db, trip, viewer_id) if member else [],
        **(extra or {}),
    }


def _pay_to(db: Session, trip: Trip, mine: TripSeat | None) -> dict | None:
    """For a confirmed rider: the driver's UPI ID and a ready-made payment link for their contribution."""
    if not mine or mine.status not in ("approved", "boarded", "dropped"):
        return None
    amount = seat_contribution(db, trip, mine)
    upi = upi_of(db, trip.driver_id)
    if amount <= 0 or not upi:
        return None
    name = profile(db, trip.driver_id).name
    note = f"FellaRide {trip.from_name.split(',')[0]} to {trip.to_name.split(',')[0]}"[:60]
    return {"upi_id": upi, "amount": amount, "link": pricing.upi_link(upi, name, amount, note)}


def active_for(db: Session, user_id: int) -> Trip | None:
    """The one trip this person is busy with right now: driving it, or approved / on board."""
    expire_stale(db)
    t = db.scalar(select(Trip).where(Trip.driver_id == user_id, Trip.status.in_(("open", "started"))).order_by(Trip.id.desc()))
    if t:
        return t
    return db.scalar(select(Trip).join(TripSeat, TripSeat.trip_id == Trip.id).where(
        TripSeat.rider_id == user_id, TripSeat.status.in_(ON_TRIP), Trip.status.in_(("open", "started"))).order_by(Trip.id.desc()))


def pending_for(db: Session, user_id: int) -> list[Trip]:
    return list(db.scalars(select(Trip).join(TripSeat, TripSeat.trip_id == Trip.id).where(
        TripSeat.rider_id == user_id, TripSeat.status == "pending", Trip.status.in_(("open", "started"))).order_by(Trip.depart_at)))


def history_for(db: Session, user_id: int, limit: int = 20) -> list[Trip]:
    rode = select(TripSeat.trip_id).where(TripSeat.rider_id == user_id, TripSeat.status.in_(RODE + ("missed",)))
    return list(db.scalars(select(Trip).where(
        or_(Trip.driver_id == user_id, Trip.id.in_(rode)),
        Trip.status.in_(("completed", "cancelled", "expired"))).order_by(Trip.depart_at.desc()).limit(limit)))


# ---------- geometry ----------
def nearest_on_route(route: list, lat: float, lon: float) -> tuple[float, int]:
    best, idx = float("inf"), 0
    for i, (plat, plon) in enumerate(route):
        d = haversine_km(lat, lon, plat, plon)
        if d < best:
            best, idx = d, i
    return best, idx


def search(db: Session, tenant_id: int, user_id: int, from_lat: float, from_lon: float,
           to_lat: float | None, to_lon: float | None, when: datetime | None) -> list[dict]:
    expire_stale(db)
    stmt = select(Trip).where(Trip.tenant_id == tenant_id, Trip.status.in_(("open", "started")),
                              Trip.driver_id != user_id, Trip.depart_at >= now() - timedelta(minutes=30))
    if when:
        when = utc(when)
        stmt = stmt.where(Trip.depart_at.between(when - timedelta(minutes=90), when + timedelta(minutes=90)))
    out = []
    with read_cache(db):
        out = _search_rows(db, stmt, user_id, from_lat, from_lon, to_lat, to_lon)
    out.sort(key=lambda r: r["pickup_km"] + (r["drop_km"] or 0))
    return out


def _search_rows(db: Session, stmt, user_id: int, from_lat: float, from_lon: float, to_lat: float | None, to_lon: float | None) -> list[dict]:
    out = []
    for t in db.scalars(stmt.order_by(Trip.depart_at).limit(300)):
        pickup_km, pi = nearest_on_route(t.route, from_lat, from_lon)
        if pickup_km > NEAR_KM:
            continue
        drop_km = None
        if to_lat is not None and to_lon is not None:
            drop_km, di = nearest_on_route(t.route, to_lat, to_lon)
            if drop_km > NEAR_KM or di < pi:
                continue
        if seats_left(db, t) == 0 and not seat_of(db, t, user_id):
            continue
        rider_km = pricing.along_route_km(t.route, from_lat, from_lon, to_lat, to_lon)
        out.append(trip_out(db, t, user_id, {"pickup_km": round(pickup_km, 2),
                                              "drop_km": round(drop_km, 2) if drop_km is not None else None,
                                              "per_seat": contribution(db, t, rider_km), "rider_km": round(rider_km, 1)}))
    return out


# ---------- driver: post ----------
def post_trip(db: Session, user: User, body) -> tuple[Trip, int]:
    """Returns the trip and how many people near the route were told about it."""
    p = profile(db, user.id)
    if active_for(db, user.id):
        raise TripError(409, "You already have a ride in progress. Finish or cancel it first.")
    if not body.licence_confirmed:
        raise TripError(422, "Tick the box to confirm you have a valid driving licence.")
    if not body.cost_share_confirmed:
        raise TripError(422, "Tick the box to confirm you're sharing costs, not running a taxi.")
    cap = pricing.max_per_km(body.seats)
    if body.price_per_km is not None and body.price_per_km > cap + 1e-9:
        raise TripError(422, f"That's more than the trip costs. FellaRide is cost-sharing only: with {body.seats} "
                             f"seat{'s' if body.seats != 1 else ''}, at most Rs {cap:g} per km.")
    depart = utc(body.depart_at)
    if depart < now() - timedelta(minutes=10) or depart > now() + timedelta(days=7):
        raise TripError(422, "Pick a leaving time between now and the next 7 days.")
    route = [[round(a, 5), round(b, 5)] for a, b in body.route] or [[body.from_lat, body.from_lon], [body.to_lat, body.to_lon]]
    t = Trip(tenant_id=user.tenant_id, driver_id=user.id, from_name=body.from_name.strip(), from_lat=body.from_lat,
             from_lon=body.from_lon, to_name=body.to_name.strip(), to_lat=body.to_lat, to_lon=body.to_lon,
             depart_at=depart, route=route, route_km=round(body.route_km, 1), route_min=body.route_min,
             seats_total=body.seats, code=f"{secrets.randbelow(10000):04d}")
    db.add(t)
    if body.car:
        save_car(db, user.id, body.car.model, body.car.colour, body.car.plate)
    if body.upi_id:
        save_upi(db, user.id, body.upi_id)
    db.flush()
    if body.price_per_km is not None and abs(body.price_per_km - pricing.default_per_km(body.seats)) > 1e-9:
        db.add(TripPrice(trip_id=t.id, per_km=round(body.price_per_km, 2)))
    lic = db.get(DriverLicence, user.id) or DriverLicence(user_id=user.id)
    lic.confirmed_at = now()
    db.add(lic)
    p.last_lat, p.last_lon = body.from_lat, body.from_lon
    db.flush()
    sent = notify_nearby(db, t, p)
    activation.safe(db, activation.on_trip_posted, t, user)
    return t, sent


def notify_nearby(db: Session, trip: Trip, driver: Profile) -> int:
    """Everyone in the community whose last known location is near the route hears about the new ride."""
    sent = 0
    rows = db.execute(select(Profile).join(User, User.id == Profile.user_id).where(
        User.tenant_id == trip.tenant_id, Profile.user_id != trip.driver_id, Profile.last_lat.is_not(None)))
    for (p,) in rows:
        if nearest_on_route(trip.route, p.last_lat, p.last_lon)[0] <= NEAR_KM:
            alert(db, p.user_id, "trip_nearby", f"Ride near you to {trip.to_name}",
                  f"{driver.name} ({gender_word(driver.gender)}) {leaves_in(trip.depart_at)} from {trip.from_name}. "
                  f"{trip.seats_total} seat{'s' if trip.seats_total != 1 else ''}.", trip.id)
            sent += 1
    return sent


def gender_word(g: str) -> str:
    return {"female": "female", "male": "male", "other": "non-binary"}.get(g, "gender not shared")


# ---------- cancelling after a seat is confirmed ----------
def too_late_to_cancel(trip: Trip) -> bool:
    return now() > utc(trip.depart_at) - CANCEL_CUTOFF


def can_cancel(db: Session, trip: Trip, viewer_id: int) -> bool:
    """Whether the viewer may still back out. A request nobody has approved can always be withdrawn, and a ride
    with no confirmed riders can always be cancelled; once a seat is confirmed, only until 10 minutes before."""
    if trip.status not in ("open", "started"):
        return False
    if trip.driver_id == viewer_id:
        rows = seats(db, trip)
        if any(x.status in RODE for x in rows):
            return False
        return not any(x.status == "approved" for x in rows) or not too_late_to_cancel(trip)
    mine = seat_of(db, trip, viewer_id)
    if not mine or mine.status not in ("pending", "approved"):
        return False
    return mine.status == "pending" or not too_late_to_cancel(trip)


def cutoff_words(trip: Trip) -> str:
    return f"Cancelling closes {int(CANCEL_CUTOFF.total_seconds() // 60)} minutes before departure"


# ---------- live tracking ----------
def tracking_window(trip: Trip) -> bool:
    """Live tracking runs while the ride is under way, and from 30 minutes before it is due to leave."""
    if trip.status == "started":
        return True
    return trip.status == "open" and now() >= utc(trip.depart_at) - TRACK_FROM


def share_location(db: Session, trip: Trip, user: User, lat: float, lon: float, heading: float | None = None,
                   speed_kmh: float | None = None) -> TripLocation:
    """Store the newest position of the driver, or of an approved rider who is waiting to be picked up."""
    if trip.status not in ("open", "started"):
        raise TripError(409, "This ride has ended, so live location is off.")
    if trip.driver_id != user.id:
        mine = seat_of(db, trip, user.id)
        if not mine or mine.status not in ON_TRIP:
            raise TripError(403, "Only the driver and confirmed riders share their location.")
    if not tracking_window(trip):
        raise TripError(409, "Live location starts 30 minutes before the ride leaves.")
    loc = db.get(TripLocation, (trip.id, user.id))
    if not loc:
        loc = TripLocation(trip_id=trip.id, user_id=user.id, lat=lat, lon=lon)
        db.add(loc)
    loc.lat, loc.lon, loc.heading, loc.speed_kmh, loc.updated_at = lat, lon, heading, speed_kmh, now()
    db.flush()
    return loc


def stop_tracking(db: Session, trip: Trip) -> None:
    db.execute(TripLocation.__table__.delete().where(TripLocation.trip_id == trip.id))


def _eta_min(km: float, speed_kmh: float | None) -> int:
    v = speed_kmh if speed_kmh and speed_kmh > 5 else AVG_CITY_KMH
    return max(1, round(km * 1.3 / v * 60))      # x1.3: roads are not straight lines


def live_positions(db: Session, trip: Trip, viewer_id: int) -> list[dict]:
    """What the viewer may see live: riders see the driver (how far, roughly when); the driver sees the
    confirmed riders still waiting at their pickup. Only fresh points, only while tracking is on."""
    if not tracking_window(trip):
        return []
    rows = {loc.user_id: loc for loc in db.scalars(select(TripLocation).where(TripLocation.trip_id == trip.id))}
    fresh = {uid: loc for uid, loc in rows.items() if now() - utc(loc.updated_at) <= TRACK_FRESH}
    out = []
    if viewer_id == trip.driver_id:
        for x in seats(db, trip):
            loc = fresh.get(x.rider_id)
            if x.status == "approved" and loc:
                out.append({"user_id": x.rider_id, "role": "rider", "name": profile(db, x.rider_id).name,
                            "lat": loc.lat, "lon": loc.lon, "heading": loc.heading,
                            "age_s": int((now() - utc(loc.updated_at)).total_seconds())})
        return out
    loc = fresh.get(trip.driver_id)
    if loc:
        mine = seat_of(db, trip, viewer_id)
        item = {"user_id": trip.driver_id, "role": "driver", "name": profile(db, trip.driver_id).name,
                "lat": loc.lat, "lon": loc.lon, "heading": loc.heading,
                "age_s": int((now() - utc(loc.updated_at)).total_seconds())}
        if mine and mine.status == "approved" and mine.pickup_lat is not None:   # still waiting: how far is the car
            km = haversine_km(loc.lat, loc.lon, mine.pickup_lat, mine.pickup_lon)
            item["km_to_you"], item["eta_min"] = round(km, 1), _eta_min(km, loc.speed_kmh)
        else:                                                                    # in the car: how far to the end
            km = haversine_km(loc.lat, loc.lon, trip.to_lat, trip.to_lon)
            item["km_to_end"], item["eta_min"] = round(km, 1), _eta_min(km, loc.speed_kmh)
        out.append(item)
    return out


# ---------- rider: ask, withdraw ----------
def request_seat(db: Session, trip: Trip, user: User, pickup_name: str, pickup_lat: float | None, pickup_lon: float | None,
                 count: int = 1) -> TripSeat:
    """Ask for `count` seats (you plus friends travelling with you). Asking again while pending changes the count."""
    p = profile(db, user.id)
    if trip.driver_id == user.id:
        raise TripError(409, "This is your own ride.")
    if trip.status not in ("open", "started"):
        raise TripError(409, "This ride isn't taking requests any more.")
    busy = active_for(db, user.id)
    if busy and busy.id != trip.id:
        raise TripError(409, "You already have a ride in progress. Finish or withdraw from it first.")
    s = seat_of(db, trip, user.id)
    if s and s.status == "rejected":
        raise TripError(409, "The driver declined your request for this ride.")
    if count < 1 or count > trip.seats_total:
        raise TripError(422, f"This car has {seats_word(trip.seats_total)} in all.")
    left = seats_left(db, trip)
    if s and s.status == "pending":
        if count != seat_count(db, s):   # changing how many seats a waiting request is for
            if count > left:
                raise TripError(409, f"Only {seats_word(left)} left on this ride.")
            set_seat_count(db, s, count)
            alert(db, trip.driver_id, "seat_request", f"{p.name} now needs {seats_word(count)}", "Approve or decline.", trip.id)
            db.flush()
        return s
    if s and s.status != "withdrawn":
        return s
    if left == 0:
        raise TripError(409, "This ride is full.")
    if count > left:
        raise TripError(409, f"Only {seats_word(left)} left on this ride, and you asked for {count}.")
    if s:
        s.status = "pending"
    else:
        s = TripSeat(trip_id=trip.id, rider_id=user.id)
        db.add(s)
        db.flush()
    set_seat_count(db, s, count)
    s.pickup_name, s.pickup_lat, s.pickup_lon = (pickup_name or "").strip()[:160], pickup_lat, pickup_lon
    if pickup_lat is not None and pickup_lon is not None:
        p.last_lat, p.last_lon = pickup_lat, pickup_lon
    rating = rating_of(db, user.id)
    stars = f"rated {rating['average']:.1f}" if rating["average"] else "new rider"
    alert(db, trip.driver_id, "seat_request", f"{p.name} wants {'a seat' if count == 1 else seats_word(count)}",
          f"{gender_word(p.gender).capitalize()}, {stars}. Pickup: {s.pickup_name or 'on your route'}. Approve or decline.", trip.id)
    db.flush()
    activation.safe(db, activation.on_seat_requested, trip, s, user)
    return s


def withdraw(db: Session, trip: Trip, user: User) -> TripSeat:
    s = seat_of(db, trip, user.id)
    if not s or s.status not in ("pending", "approved"):
        raise TripError(409, "There is no request of yours to withdraw.")
    was = s.status
    if was == "approved" and too_late_to_cancel(trip):
        raise TripError(409, f"{cutoff_words(trip)}. Message or call the driver if something has come up.")
    s.status = "withdrawn"
    if was == "approved":
        alert(db, trip.driver_id, "rider_left", f"{profile(db, user.id).name} can't make it",
              f"They cancelled their {seats_word(seat_count(db, s))}, so {'it is' if seat_count(db, s) == 1 else 'they are'} free again.", trip.id)
    db.flush()
    return s


# ---------- driver: decide, board, start, end, cancel ----------
def _driver_only(trip: Trip, user: User) -> None:
    if trip.driver_id != user.id:
        raise TripError(403, "Only the driver can do this.")


def _seat(db: Session, trip: Trip, seat_id: int) -> TripSeat:
    s = db.get(TripSeat, seat_id)
    if not s or s.trip_id != trip.id:
        raise TripError(404, "That rider isn't on this ride.")
    return s


def _contribution_words(db: Session, trip: Trip, s: TripSeat) -> str:
    amount = seat_contribution(db, trip, s)
    if amount <= 0:
        return "It's a free ride. "
    return f"Your contribution is Rs {amount}, paid to the driver by UPI or cash. "


def decide(db: Session, trip: Trip, user: User, seat_id: int, approve: bool) -> TripSeat:
    _driver_only(trip, user)
    s = _seat(db, trip, seat_id)
    if s.status != "pending":
        raise TripError(409, "You've already answered this request.")
    if trip.status not in ("open", "started"):
        raise TripError(409, "This ride has ended.")
    driver = profile(db, user.id)
    if not approve:
        s.status = "rejected"
        alert(db, s.rider_id, "declined", f"{driver.name} couldn't take you", "Try another ride going your way.", trip.id)
        db.flush()
        return s
    lock_rider(db, s.rider_id)   # so two drivers can't both approve the same rider at once
    left, need = seats_left(db, trip), seat_count(db, s)
    if left == 0:
        raise TripError(409, "Your car is already full.")
    if need > left:
        raise TripError(409, f"They asked for {seats_word(need)} but you have {seats_word(left)} left.")
    busy = active_for(db, s.rider_id)
    if busy and busy.id != trip.id:
        s.status = "withdrawn"
        db.flush()
        raise TripError(409, "This rider has just joined another ride.")
    s.status = "approved"
    car = car_words(car_of(db, trip.driver_id, show_plate=True))
    alert(db, s.rider_id, "approved", f"{driver.name} approved your seat",
          (f"Look for a {car}. " if car else "") +
          (f"{seats_word(need).capitalize()} held for you. " if need > 1 else "") + _contribution_words(db, trip, s) + f"Your boarding code is {trip.code}. Check it matches the driver's before you get in. You can chat or call now.", trip.id)
    # the rider is set: their other requests are dropped
    for other in db.scalars(select(TripSeat).where(TripSeat.rider_id == s.rider_id, TripSeat.status == "pending", TripSeat.id != s.id)):
        other.status = "withdrawn"
    db.flush()
    # requests that no longer fit (the car is full, or they need more seats than are left) are declined
    left = seats_left(db, trip)
    for other in db.scalars(select(TripSeat).where(TripSeat.trip_id == trip.id, TripSeat.status == "pending")):
        if seat_count(db, other) > left:
            other.status = "rejected"
            alert(db, other.rider_id, "declined", "That ride is now full" if left == 0 else f"Only {seats_word(left)} left on that ride",
                  "Try another ride going your way.", trip.id)
    db.flush()
    return s


def board(db: Session, trip: Trip, user: User, seat_id: int) -> TripSeat:
    _driver_only(trip, user)
    s = _seat(db, trip, seat_id)
    if s.status != "approved":
        raise TripError(409, "Only an approved rider who hasn't got in yet can be marked as in the car.")
    if trip.status not in ("open", "started"):
        raise TripError(409, "This ride has ended.")
    s.status = "boarded"
    alert(db, s.rider_id, "boarded", "You're in. Have a good ride",
          "The driver marked you as in the car. Tap End my ride when you get off.", trip.id)
    db.flush()
    return s


def start(db: Session, trip: Trip, user: User) -> Trip:
    _driver_only(trip, user)
    if trip.status != "open":
        raise TripError(409, "This ride has already started or ended.")
    trip.status, trip.started_at = "started", now()
    driver = profile(db, user.id)
    for s in seats(db, trip):
        if s.status in ON_TRIP:
            alert(db, s.rider_id, "started", f"{driver.name} has set off",
                  "Be ready at your pickup point." if s.status == "approved" else "Enjoy the ride.", trip.id)
    db.flush()
    return trip


def _finish(db: Session, trip: Trip) -> None:
    """Close the trip: riders never picked up are 'missed'; the driver pays if they left before the time."""
    trip.status, trip.ended_at = "completed", now()
    trip.started_at = trip.started_at or trip.ended_at
    stop_tracking(db, trip)
    missed = []
    for s in seats(db, trip):
        if s.status == "boarded":
            s.status = "dropped"
        elif s.status == "approved":
            s.status = "missed"
            missed.append(s)
        elif s.status == "pending":
            s.status = "rejected"
    left_early = utc(trip.started_at) < utc(trip.depart_at) - timedelta(minutes=EARLY_GRACE_MIN)
    driver = profile(db, trip.driver_id)
    for s in missed:
        alert(db, s.rider_id, "missed", f"{driver.name} left without you",
              "The ride ended before you were picked up." + (" They left before the planned time, which lowers their rating." if left_early else ""),
              trip.id)
    if missed and left_early:
        _penalty(db, trip, 1, "left_early")
        alert(db, trip.driver_id, "penalty", "Your rating dropped",
              "You left before the planned time and an approved rider was left behind.", trip.id)
    for uid in [trip.driver_id] + [s.rider_id for s in seats(db, trip) if s.status == "dropped"]:
        if rate_targets(db, trip, uid):
            alert(db, uid, "rate", "How was the ride?", "Rate the people you travelled with.", trip.id)
    db.flush()
    activation.safe(db, activation.on_trip_finished, trip)


def _penalty(db: Session, trip: Trip, stars: int, kind: str) -> None:
    if not db.scalar(select(Rating.id).where(Rating.trip_id == trip.id, Rating.to_id == trip.driver_id, Rating.kind == kind)):
        db.add(Rating(trip_id=trip.id, from_id=None, to_id=trip.driver_id, stars=stars, kind=kind))


def end(db: Session, trip: Trip, user: User) -> Trip:
    """Driver: ends the whole trip. Rider: ends their own part (and the trip, if they were the last one)."""
    if trip.status not in ("open", "started"):
        raise TripError(409, "This ride has already ended.")
    if trip.driver_id == user.id:
        _finish(db, trip)
        db.flush()
        return trip
    s = seat_of(db, trip, user.id)
    if not s or s.status != "boarded":
        raise TripError(409, "You can end your ride once the driver has marked you as in the car.")
    s.status = "dropped"
    db.flush()   # the session doesn't autoflush; the count below must see this
    rider = profile(db, user.id)
    alert(db, trip.driver_id, "dropped", f"{rider.name} has got off", "", trip.id)
    still = db.scalar(select(func.count(TripSeat.id)).where(TripSeat.trip_id == trip.id, TripSeat.status.in_(ON_TRIP)))
    if still == 0:   # last rider: the ride is over for everyone
        _finish(db, trip)
        alert(db, trip.driver_id, "ended", "Ride complete", f"{rider.name} was the last rider, so the ride has ended.", trip.id)
    else:
        alert(db, user.id, "rate", "How was the ride?", "Rate the people you travelled with.", trip.id)
    db.flush()
    return trip


def cancel(db: Session, trip: Trip, user: User) -> Trip:
    _driver_only(trip, user)
    if trip.status not in ("open", "started"):
        raise TripError(409, "This ride has already ended.")
    rows = seats(db, trip)
    if any(s.status in RODE for s in rows):
        raise TripError(409, "Someone is already in the car. End the ride instead.")
    driver = profile(db, user.id)
    approved = [s for s in rows if s.status == "approved"]
    if approved and too_late_to_cancel(trip):
        raise TripError(409, f"{cutoff_words(trip)} once riders are confirmed. Message them in the chat if something has come up.")
    for s in rows:
        if s.status in ("pending", "approved"):
            s.status = "cancelled" if s.status == "approved" else "rejected"   # keeps "was approved" for match rate
            alert(db, s.rider_id, "cancelled", f"{driver.name} cancelled the ride", "Try another ride going your way.", trip.id)
    trip.status, trip.ended_at = "cancelled", now()
    stop_tracking(db, trip)
    if approved:
        _penalty(db, trip, 2, "cancelled")
    db.flush()
    activation.safe(db, activation.on_trip_cancelled, trip, bool(approved))
    return trip


# ---------- settling up (outside the app) ----------
def mark_paid(db: Session, trip: Trip, user: User) -> SeatPayment:
    """The rider says they paid their contribution (by UPI or cash). The driver is told."""
    s = seat_of(db, trip, user.id)
    if not s or s.status not in ("approved", "boarded", "dropped"):
        raise TripError(409, "Only a confirmed rider can mark their contribution as paid.")
    if seat_contribution(db, trip, s) <= 0:
        raise TripError(409, "This is a free ride, so there's nothing to pay.")
    p = db.get(SeatPayment, s.id) or SeatPayment(seat_id=s.id)
    p.rider_paid_at = p.rider_paid_at or now()
    db.add(p)
    alert(db, trip.driver_id, "paid", f"{profile(db, user.id).name} says they paid",
          f"Rs {seat_contribution(db, trip, s)} for this ride. Tap Received once you see it.", trip.id)
    db.flush()
    return p


def mark_received(db: Session, trip: Trip, user: User, seat_id: int) -> SeatPayment:
    """The driver confirms a rider's contribution arrived."""
    _driver_only(trip, user)
    s = _seat(db, trip, seat_id)
    if s.status not in ("approved", "boarded", "dropped"):
        raise TripError(409, "That rider isn't confirmed on this ride.")
    p = db.get(SeatPayment, s.id) or SeatPayment(seat_id=s.id)
    p.driver_got_at = p.driver_got_at or now()
    p.rider_paid_at = p.rider_paid_at or p.driver_got_at
    db.add(p)
    db.flush()
    return p


# ---------- chat and driver updates ----------
def messages(db: Session, trip: Trip, user: User, after_id: int = 0) -> list[dict]:
    if not in_group(db, trip, user.id):
        raise TripError(403, "Chat opens once your seat is approved.")
    rows = db.scalars(select(TripMessage).where(TripMessage.trip_id == trip.id, TripMessage.id > after_id).order_by(TripMessage.id).limit(200))
    names: dict[int, str] = {}
    out = []
    for m in rows:
        if m.user_id not in names:
            names[m.user_id] = person(db, m.user_id)["name"]
        out.append({"id": m.id, "user_id": m.user_id, "name": names[m.user_id], "body": m.body,
                    "created_at": utc(m.created_at).isoformat()})
    return out


def group_ids(db: Session, trip: Trip) -> list[int]:
    return [trip.driver_id] + [s.rider_id for s in seats(db, trip) if s.status in ON_TRIP + ("dropped",)]


def post_message(db: Session, trip: Trip, user: User, body: str, as_update: bool = False) -> TripMessage:
    if not in_group(db, trip, user.id):
        raise TripError(403, "Chat opens once your seat is approved.")
    if as_update and trip.driver_id != user.id:
        raise TripError(403, "Only the driver can send ride updates.")
    m = TripMessage(trip_id=trip.id, user_id=user.id, body=body.strip()[:500])
    db.add(m)
    name = profile(db, user.id).name
    for uid in group_ids(db, trip):
        if uid == user.id:
            continue
        if as_update:
            alert(db, uid, "driver_update", f"{name}: {m.body}"[:160], "Update from your driver.", trip.id)
            continue
        # one unread "new messages" alert per trip, refreshed instead of piling up
        a = db.scalar(select(Alert).where(Alert.user_id == uid, Alert.trip_id == trip.id, Alert.kind == "message", Alert.read.is_(False)))
        if a:
            a.title, a.body, a.created_at = f"New message from {name}", m.body[:400], now()
        else:
            alert(db, uid, "message", f"New message from {name}", m.body, trip.id)
    db.flush()
    return m


# ---------- ratings ----------
def rate_targets(db: Session, trip: Trip, user_id: int) -> list[dict]:
    """Who this person can rate on this trip: everyone they actually travelled with, once their part is over."""
    rows = seats(db, trip)
    rode = [s.rider_id for s in rows if s.status in RODE]
    if trip.driver_id == user_id:
        if trip.status != "completed":
            return []
        others = rode
    else:
        mine = next((s for s in rows if s.rider_id == user_id), None)
        if not mine or mine.status != "dropped":
            return []
        others = [trip.driver_id] + [r for r in rode if r != user_id]
    done = set(db.scalars(select(Rating.to_id).where(Rating.trip_id == trip.id, Rating.from_id == user_id)))
    return [{**person(db, uid), "role": "driver" if uid == trip.driver_id else "rider", "rated": uid in done} for uid in others]


def rate(db: Session, trip: Trip, user: User, to_id: int, stars: int, comment: str) -> Rating:
    target = next((t for t in rate_targets(db, trip, user.id) if t["id"] == to_id), None)
    if not target:
        raise TripError(403, "You can rate people you travelled with, once your ride is over.")
    if target["rated"]:
        raise TripError(409, "You already rated this person for this ride.")
    r = Rating(trip_id=trip.id, from_id=user.id, to_id=to_id, stars=stars, comment=comment.strip()[:280])
    db.add(r)
    db.flush()
    activation.safe(db, activation.on_rating, trip, r)
    return r


# ---------- reports ----------
def report(db: Session, trip: Trip, user: User, reported_id: int, reasons: list[str], note: str) -> Report:
    if reported_id == user.id:
        raise TripError(422, "You can't report yourself.")
    involved = {trip.driver_id} | {s.rider_id for s in seats(db, trip)}
    if user.id not in involved or reported_id not in involved:
        raise TripError(403, "You can only report people from a ride you were part of.")
    bad = sorted(set(reasons) - set(REPORT_REASONS))
    if bad or not reasons:
        raise TripError(422, "Pick at least one reason from the list.")
    cats = {REPORT_REASONS[r][0] for r in reasons}
    category = next(c for c in CATEGORY_ORDER if c in cats)
    rep = Report(tenant_id=trip.tenant_id, trip_id=trip.id, reporter_id=user.id, reported_id=reported_id,
                 reasons=sorted(set(reasons)), category=category, severity=SEVERITY[category], note=note.strip()[:500])
    db.add(rep)
    db.flush()
    return rep


def report_out(db: Session, r: Report) -> dict:
    return {"id": r.id, "trip_id": r.trip_id, "category": r.category, "severity": r.severity, "status": r.status,
            "reasons": [REPORT_REASONS[k][1] for k in r.reasons if k in REPORT_REASONS], "note": r.note,
            "reporter": person(db, r.reporter_id), "reported": person(db, r.reported_id),
            "created_at": utc(r.created_at).isoformat()}
