"""Member app (Sprint 3): profile, posted trips, seat requests, boarding, chat, ratings, reports and alerts.

Everything acts as the signed-in user and stays inside their community (or the open community, for people
who signed up without a join code). Organiser accounts can't ride; they get the overview and broadcast.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import Actor, admin_actor, auth_rate_limit, current_actor
from ..db import get_db
from ..engine import activation, referrals
from ..engine import trips as T
from ..models import Alert, Member, Profile, Rating, Referral, Report, Tenant, Trip, TripSeat, User
from ..schemas import BroadcastIn, InviteIn, LocationIn, MessageIn, ProfileIn, RatingIn, ReadIn, ReportIn, SeatRequestIn, TrackIn, TripIn, UpiIn
from .account import clean_mobile

router = APIRouter(tags=["trips"])


def rider_or_driver(actor: Actor = Depends(current_actor)) -> User:
    if actor.is_admin:
        raise HTTPException(403, "Organiser accounts can't post or book rides. Sign in with a member account.")
    return actor.user


def run(fn, *args):
    """Call an engine function and turn its TripError into the matching HTTP error."""
    try:
        return fn(*args)
    except T.TripError as e:
        raise HTTPException(e.status, str(e))


def _trip(db: Session, user: User, trip_id: int) -> Trip:
    return run(T.get_trip, db, user.tenant_id, trip_id)


# ---------- me ----------
@router.put("/me/profile", summary="Set your name, gender and mobile")
def set_profile(body: ProfileIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    mobile = clean_mobile(body.mobile)
    if db.scalar(select(Profile.user_id).where(Profile.mobile == mobile, Profile.user_id != user.id)):
        raise HTTPException(409, "Another account already uses this mobile number.")
    p = db.get(Profile, user.id)
    if not p:
        p = Profile(user_id=user.id, name="", gender="unsaid")
        db.add(p)
    p.name, p.gender, p.mobile = body.name.strip(), body.gender, mobile
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Another account already uses this mobile number.")
    return {"name": p.name, "gender": p.gender, "mobile": p.mobile, "rating": T.rating_of(db, user.id),
            "car": T.car_of(db, user.id, show_plate=True)}


@router.post("/me/location", summary="Where you are now, so you hear about rides near you")
def set_location(body: LocationIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    p = run(T.profile, db, user.id)
    p.last_lat, p.last_lon = body.lat, body.lon
    db.commit()
    return {"ok": True}


@router.get("/me/alerts", summary="Your notifications, newest first")
def my_alerts(user: User = Depends(rider_or_driver), db: Session = Depends(get_db), limit: int = Query(50, ge=1, le=200)):
    rows = db.scalars(select(Alert).where(Alert.user_id == user.id).order_by(Alert.created_at.desc(), Alert.id.desc()).limit(limit))
    unread = db.scalar(select(func.count(Alert.id)).where(Alert.user_id == user.id, Alert.read.is_(False)))
    return {"unread": unread, "items": [{"id": a.id, "kind": a.kind, "title": a.title, "body": a.body, "trip_id": a.trip_id,
                                         "read": a.read, "created_at": T.utc(a.created_at).isoformat()} for a in rows]}


@router.post("/me/alerts/read", summary="Mark notifications as read (all of them if no ids)")
def read_alerts(body: ReadIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    stmt = update(Alert).where(Alert.user_id == user.id)
    if body.ids:
        stmt = stmt.where(Alert.id.in_(body.ids))
    db.execute(stmt.values(read=True))
    db.commit()
    return {"ok": True}


@router.get("/me/trips", summary="Your ride in progress, requests you're waiting on, and past rides")
def my_trips(user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    active = T.active_for(db, user.id)
    with T.read_cache(db):   # one set of lookups for every ride in the list (read-only from here)
        out = {
            "active": T.trip_out(db, active, user.id) if active else None,
            "pending": [T.trip_out(db, t, user.id) for t in T.pending_for(db, user.id)],
            "history": [T.trip_out(db, t, user.id, {"to_rate": sum(not p["rated"] for p in T.rate_targets(db, t, user.id))})
                        for t in T.history_for(db, user.id)],
        }
    db.commit()   # expire_stale may have closed old trips
    return out


# ---------- invites (Refer) ----------
def invite_out(db: Session, r: Referral) -> dict:
    m = db.get(Member, r.invitee_id)
    return {"id": r.id, "name": m.name, "email": m.email, "status": r.status, "day": r.day}


@router.get("/me/invites", summary="People you invited, and the code they join with")
def my_invites(user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    tenant = db.get(Tenant, user.tenant_id)
    rows = db.scalars(select(Referral).where(Referral.inviter_id == user.member_id).order_by(Referral.id.desc()).limit(50)) \
        if user.member_id else []
    return {"community": tenant.name, "join_code": tenant.join_code, "invites": [invite_out(db, r) for r in rows]}


@router.post("/me/invites", status_code=201, summary="Invite someone by email; it converts when they sign up with it",
             dependencies=[Depends(auth_rate_limit)])
def invite(body: InviteIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    try:
        r = activation.invite_by_email(db, user, body.name, body.email)
    except referrals.ReferralError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return invite_out(db, r)


@router.get("/report-reasons", summary="The multiple-choice reasons for a report, by category")
def report_reasons():
    return [{"code": k, "category": c, "label": label} for k, (c, label) in T.REPORT_REASONS.items()]


# ---------- trips ----------
@router.post("/trips", status_code=201, summary="Driver: post a ride; people near the route are told")
def post_trip(body: TripIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    t, notified = run(T.post_trip, db, user, body)
    db.commit()
    return T.trip_out(db, t, user.id, {"notified": notified})


@router.get("/trips/search", summary="Rider: rides passing near your pickup (and drop, if given)")
def search(from_lat: float = Query(ge=-90, le=90), from_lon: float = Query(ge=-180, le=180),
           to_lat: float | None = Query(None, ge=-90, le=90), to_lon: float | None = Query(None, ge=-180, le=180),
           when: datetime | None = None, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    p = run(T.profile, db, user.id)
    p.last_lat, p.last_lon = from_lat, from_lon
    out = T.search(db, user.tenant_id, user.id, from_lat, from_lon, to_lat, to_lon, when)
    db.commit()
    return out


@router.get("/trips/{trip_id}", summary="One ride, as you are allowed to see it")
def get_trip(trip_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    t = _trip(db, user, trip_id)
    return T.trip_out(db, t, user.id, {"to_rate": T.rate_targets(db, t, user.id)})


def _action(trip_id: int, user: User, db: Session, fn, *args) -> dict:
    t = T.lock_trip(db, _trip(db, user, trip_id))   # one seat change per ride at a time (see engine.trips.lock_trip)
    try:
        run(fn, db, t, user, *args)
        db.commit()
    except IntegrityError:   # e.g. the same rider's request arriving twice at once: answer with the current state
        db.rollback()
        t = _trip(db, user, trip_id)
    return T.trip_out(db, t, user.id, {"to_rate": T.rate_targets(db, t, user.id)})


@router.post("/trips/{trip_id}/request", summary="Rider: ask for a seat")
def request_seat(trip_id: int, body: SeatRequestIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.request_seat, body.pickup_name, body.pickup_lat, body.pickup_lon, body.seats)


@router.post("/trips/{trip_id}/location", summary="Driver or confirmed rider: share your live position on this ride")
def share_location(trip_id: int, body: TrackIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    t = _trip(db, user, trip_id)
    run(T.share_location, db, t, user, body.lat, body.lon, body.heading, body.speed_kmh)
    db.commit()
    return {"ok": True, "live": T.live_positions(db, t, user.id)}


@router.post("/trips/{trip_id}/paid", summary="Rider: I've paid my contribution (by UPI or cash)")
def mark_paid(trip_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.mark_paid)


@router.post("/trips/{trip_id}/seats/{seat_id}/received", summary="Driver: this rider's contribution arrived")
def mark_received(trip_id: int, seat_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.mark_received, seat_id)


@router.put("/me/upi", summary="Your UPI ID, so riders can pay you their contribution (empty removes it)")
def set_upi(body: UpiIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    T.save_upi(db, user.id, body.upi_id)
    db.commit()
    return {"upi_id": T.upi_of(db, user.id)}


@router.post("/trips/{trip_id}/withdraw", summary="Rider: take back your request or approved seat")
def withdraw(trip_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.withdraw)


@router.post("/trips/{trip_id}/seats/{seat_id}/approve", summary="Driver: approve a seat request")
def approve(trip_id: int, seat_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.decide, seat_id, True)


@router.post("/trips/{trip_id}/seats/{seat_id}/reject", summary="Driver: decline a seat request")
def reject(trip_id: int, seat_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.decide, seat_id, False)


@router.post("/trips/{trip_id}/seats/{seat_id}/board", summary="Driver: this rider got in")
def board(trip_id: int, seat_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.board, seat_id)


@router.post("/trips/{trip_id}/start", summary="Driver: setting off")
def start(trip_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.start)


@router.post("/trips/{trip_id}/end", summary="Driver: end the whole ride. Rider: end your part (the whole ride if you're the last)")
def end(trip_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.end)


@router.post("/trips/{trip_id}/cancel", summary="Driver: cancel before anyone gets in")
def cancel(trip_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.cancel)


@router.get("/trips/{trip_id}/messages", summary="Ride chat (driver and approved riders)")
def get_messages(trip_id: int, after: int = Query(0, ge=0), user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return run(T.messages, db, _trip(db, user, trip_id), user, after)


@router.post("/trips/{trip_id}/messages", status_code=201, summary="Send a chat message")
def send_message(trip_id: int, body: MessageIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    m = run(T.post_message, db, _trip(db, user, trip_id), user, body.body)
    db.commit()
    return {"id": m.id}


@router.post("/trips/{trip_id}/notify", status_code=201, summary="Driver: send a ride update as a notification to every rider")
def notify_riders(trip_id: int, body: MessageIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    m = run(T.post_message, db, _trip(db, user, trip_id), user, body.body, True)
    db.commit()
    return {"id": m.id}


@router.post("/trips/{trip_id}/ratings", status_code=201, summary="Rate someone you travelled with")
def rate(trip_id: int, body: RatingIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    t = _trip(db, user, trip_id)
    run(T.rate, db, t, user, body.to_id, body.stars, body.comment)
    left = T.rate_targets(db, t, user.id)
    if all(p["rated"] for p in left):   # everyone rated: the "how was the ride?" alert is done
        db.execute(update(Alert).where(Alert.user_id == user.id, Alert.trip_id == t.id, Alert.kind == "rate").values(read=True))
    db.commit()
    return {"to_rate": left, "their_rating": T.rating_of(db, body.to_id)}


@router.post("/reports", status_code=201, summary="Report someone from a ride (multiple-choice reasons)")
def report(body: ReportIn, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    r = run(T.report, db, _trip(db, user, body.trip_id), user, body.reported_id, body.reasons, body.note)
    db.commit()
    return {"id": r.id, "category": r.category, "severity": r.severity}


# ---------- organiser ----------
@router.post("/tenants/{tenant_id}/broadcast", status_code=201, summary="Organiser: send a notification to every member")
def broadcast(tenant_id: int, body: BroadcastIn, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    ids = list(db.scalars(select(User.id).where(User.tenant_id == tenant_id, User.role == "member")))
    for uid in ids:
        T.alert(db, uid, "broadcast", body.title, body.body)
    db.commit()
    return {"sent": len(ids)}


@router.get("/tenants/{tenant_id}/trips-overview", summary="Organiser: rides, ratings and reports in the member app")
def overview(tenant_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    T.expire_stale(db)
    by_status = dict(db.execute(select(Trip.status, func.count(Trip.id)).where(Trip.tenant_id == tenant_id).group_by(Trip.status)).all())
    carried = db.scalar(select(func.count(TripSeat.id)).join(Trip, Trip.id == TripSeat.trip_id).where(
        Trip.tenant_id == tenant_id, TripSeat.status == "dropped"))
    avg = db.scalar(select(func.avg(Rating.stars)).join(Trip, Trip.id == Rating.trip_id).where(
        Trip.tenant_id == tenant_id, Rating.kind == "peer"))
    penalties = db.scalar(select(func.count(Rating.id)).join(Trip, Trip.id == Rating.trip_id).where(
        Trip.tenant_id == tenant_id, Rating.kind != "peer"))
    by_cat = dict(db.execute(select(Report.category, func.count(Report.id)).where(
        Report.tenant_id == tenant_id, Report.status == "open").group_by(Report.category)).all())
    reports = db.scalars(select(Report).where(Report.tenant_id == tenant_id).order_by(Report.id.desc()).limit(30))
    db.commit()
    return {"trips": by_status, "riders_carried": carried, "avg_rating": round(avg, 2) if avg else None,
            "penalties": penalties, "open_reports_by_category": by_cat, "reports": [T.report_out(db, r) for r in reports]}


@router.post("/tenants/{tenant_id}/reports/{report_id}/review", summary="Organiser: mark a report as reviewed")
def review(tenant_id: int, report_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    r = db.get(Report, report_id)
    if not r or r.tenant_id != tenant_id:
        raise HTTPException(404, "Report not found.")
    r.status = "reviewed"
    db.commit()
    return T.report_out(db, r)
