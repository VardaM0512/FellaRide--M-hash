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

from ..models import Alert, Profile, Rating, Report, Trip, TripMessage, TripSeat, User
from . import activation
from .geo import haversine_km

NEAR_KM = 2.5            # "near you" alerts and search radius around the route
EARLY_GRACE_MIN = 5
STALE_AFTER = timedelta(hours=3)   # an open trip this long past its time is expired
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
    "asked_money": ("fraud", "Asked for extra money"),
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
def rating_of(db: Session, user_id: int) -> dict:
    stars = list(db.scalars(select(Rating.stars).where(Rating.to_id == user_id).order_by(Rating.id.desc()).limit(RATING_WINDOW)))
    if not stars:
        return {"average": None, "count": 0}
    weights = [RECENCY ** i for i in range(len(stars))]
    avg = sum(s * w for s, w in zip(stars, weights)) / sum(weights)
    total = db.scalar(select(func.count(Rating.id)).where(Rating.to_id == user_id))
    return {"average": round(avg, 2), "count": total}


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


def alert(db: Session, user_id: int, kind: str, title: str, body: str = "", trip_id: int | None = None) -> None:
    db.add(Alert(user_id=user_id, kind=kind, title=title[:160], body=body[:400], trip_id=trip_id))


# ---------- reading trips ----------
def expire_stale(db: Session) -> None:
    db.execute(update(Trip).where(Trip.status == "open", Trip.depart_at < now() - STALE_AFTER).values(status="expired")
               .execution_options(synchronize_session="fetch"))


def get_trip(db: Session, tenant_id: int, trip_id: int) -> Trip:
    t = db.get(Trip, trip_id)
    if not t or t.tenant_id != tenant_id:
        raise TripError(404, "That ride doesn't exist or has been removed.")
    return t


def seats(db: Session, trip: Trip) -> list[TripSeat]:
    return list(db.scalars(select(TripSeat).where(TripSeat.trip_id == trip.id).order_by(TripSeat.id)))


def seat_of(db: Session, trip: Trip, user_id: int) -> TripSeat | None:
    return db.scalar(select(TripSeat).where(TripSeat.trip_id == trip.id, TripSeat.rider_id == user_id))


def seats_left(db: Session, trip: Trip) -> int:
    taken = db.scalar(select(func.count(TripSeat.id)).where(TripSeat.trip_id == trip.id, TripSeat.status.in_(ON_TRIP + ("dropped",))))
    return max(0, trip.seats_total - taken)


def in_group(db: Session, trip: Trip, user_id: int) -> bool:
    if trip.driver_id == user_id:
        return True
    s = seat_of(db, trip, user_id)
    return bool(s and s.status in IN_GROUP)


def trip_out(db: Session, trip: Trip, viewer_id: int, extra: dict | None = None) -> dict:
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
            rider_rows.append({"seat_id": s.id, "status": s.status, "pickup_name": s.pickup_name,
                               "person": person(db, s.rider_id, show_mobile=is_driver and s.status in IN_GROUP)})
    return {
        "id": trip.id, "status": trip.status,
        "from": {"name": trip.from_name, "lat": trip.from_lat, "lon": trip.from_lon},
        "to": {"name": trip.to_name, "lat": trip.to_lat, "lon": trip.to_lon},
        "depart_at": utc(trip.depart_at).isoformat(), "started_at": utc(trip.started_at).isoformat() if trip.started_at else None,
        "route": trip.route, "route_km": trip.route_km, "route_min": trip.route_min,
        "seats_total": trip.seats_total, "seats_left": seats_left(db, trip),
        "driver": person(db, trip.driver_id, show_mobile=bool(mine and mine.status in ON_TRIP)),
        "you": "driver" if is_driver else "rider" if mine else "none",
        "my_seat": {"id": mine.id, "status": mine.status} if mine else None,
        "code": trip.code if member else None,
        "riders": rider_rows,
        **(extra or {}),
    }


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
        out.append(trip_out(db, t, user_id, {"pickup_km": round(pickup_km, 2),
                                              "drop_km": round(drop_km, 2) if drop_km is not None else None}))
    out.sort(key=lambda r: r["pickup_km"] + (r["drop_km"] or 0))
    return out


# ---------- driver: post ----------
def post_trip(db: Session, user: User, body) -> tuple[Trip, int]:
    """Returns the trip and how many people near the route were told about it."""
    p = profile(db, user.id)
    if active_for(db, user.id):
        raise TripError(409, "You already have a ride in progress. Finish or cancel it first.")
    depart = utc(body.depart_at)
    if depart < now() - timedelta(minutes=10) or depart > now() + timedelta(days=7):
        raise TripError(422, "Pick a leaving time between now and the next 7 days.")
    route = [[round(a, 5), round(b, 5)] for a, b in body.route] or [[body.from_lat, body.from_lon], [body.to_lat, body.to_lon]]
    t = Trip(tenant_id=user.tenant_id, driver_id=user.id, from_name=body.from_name.strip(), from_lat=body.from_lat,
             from_lon=body.from_lon, to_name=body.to_name.strip(), to_lat=body.to_lat, to_lon=body.to_lon,
             depart_at=depart, route=route, route_km=round(body.route_km, 1), route_min=body.route_min,
             seats_total=body.seats, code=f"{secrets.randbelow(10000):04d}")
    db.add(t)
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
    return {"female": "woman", "male": "man", "other": "non-binary"}.get(g, "gender not shared")


# ---------- rider: ask, withdraw ----------
def request_seat(db: Session, trip: Trip, user: User, pickup_name: str, pickup_lat: float | None, pickup_lon: float | None) -> TripSeat:
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
    if s and s.status != "withdrawn":
        return s
    if seats_left(db, trip) == 0:
        raise TripError(409, "This ride is full.")
    if s:
        s.status = "pending"
    else:
        s = TripSeat(trip_id=trip.id, rider_id=user.id)
        db.add(s)
    s.pickup_name, s.pickup_lat, s.pickup_lon = (pickup_name or "").strip()[:160], pickup_lat, pickup_lon
    if pickup_lat is not None and pickup_lon is not None:
        p.last_lat, p.last_lon = pickup_lat, pickup_lon
    rating = rating_of(db, user.id)
    stars = f"rated {rating['average']:.1f}" if rating["average"] else "new rider"
    alert(db, trip.driver_id, "seat_request", f"{p.name} wants a seat",
          f"{gender_word(p.gender).capitalize()}, {stars}. Pickup: {s.pickup_name or 'on your route'}. Approve or decline.", trip.id)
    db.flush()
    activation.safe(db, activation.on_seat_requested, trip, s, user)
    return s


def withdraw(db: Session, trip: Trip, user: User) -> TripSeat:
    s = seat_of(db, trip, user.id)
    if not s or s.status not in ("pending", "approved"):
        raise TripError(409, "There is no request of yours to withdraw.")
    was = s.status
    s.status = "withdrawn"
    if was == "approved":
        alert(db, trip.driver_id, "rider_left", f"{profile(db, user.id).name} can't make it",
              "They withdrew from your ride, so a seat is free again.", trip.id)
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
    if seats_left(db, trip) == 0:
        raise TripError(409, "Your car is already full.")
    busy = active_for(db, s.rider_id)
    if busy and busy.id != trip.id:
        s.status = "withdrawn"
        db.flush()
        raise TripError(409, "This rider has just joined another ride.")
    s.status = "approved"
    alert(db, s.rider_id, "approved", f"{driver.name} approved your seat",
          f"Your boarding code is {trip.code}. Check it matches the driver's before you get in. You can chat or call now.", trip.id)
    # the rider is set: their other requests are dropped
    for other in db.scalars(select(TripSeat).where(TripSeat.rider_id == s.rider_id, TripSeat.status == "pending", TripSeat.id != s.id)):
        other.status = "withdrawn"
    db.flush()
    if seats_left(db, trip) == 0:
        for other in db.scalars(select(TripSeat).where(TripSeat.trip_id == trip.id, TripSeat.status == "pending")):
            other.status = "rejected"
            alert(db, other.rider_id, "declined", "That ride is now full", "Try another ride going your way.", trip.id)
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
    for s in rows:
        if s.status in ("pending", "approved"):
            s.status = "cancelled" if s.status == "approved" else "rejected"   # keeps "was approved" for match rate
            alert(db, s.rider_id, "cancelled", f"{driver.name} cancelled the ride", "Try another ride going your way.", trip.id)
    trip.status, trip.ended_at = "cancelled", now()
    if approved:
        _penalty(db, trip, 2, "cancelled")
    db.flush()
    activation.safe(db, activation.on_trip_cancelled, trip, bool(approved))
    return trip


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
