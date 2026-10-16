"""Member app (Sprint 3): profile, posted trips, seat requests, boarding, chat, ratings, reports and alerts.

Everything acts as the signed-in user and stays inside their community (or the open community, for people
who signed up without a join code). Organiser accounts can't ride; they get the overview and broadcast.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import Actor, admin_actor, auth_rate_limit, current_actor, member_actor
from ..db import get_db
from ..engine import activation, live, pricing, referrals
from ..engine import trips as T
from ..models import Alert, Broadcast, Car, CommunityPricing, Member, Suspension, Profile, Rating, Referral, Report, Tenant, Trip, TripSeat, User
from ..schemas import BroadcastIn, InviteIn, LocationIn, MessageIn, PricingIn, ProfileIn, SuspendIn, RatingIn, ReadIn, ReportIn, SeatRequestIn, TrackIn, TripIn, UpiIn
from .account import checked_mobile, email_verified, mobile_owner, verification_required

router = APIRouter(tags=["trips"])


def rider_or_driver(actor: Actor = Depends(current_actor)) -> User:
    if actor.is_admin:
        raise HTTPException(403, "Organiser accounts can't post or book rides. Sign in with a member account.")
    return actor.user


def verified_member(user: User = Depends(rider_or_driver), db: Session = Depends(get_db)) -> User:
    """Posting a ride or asking for a seat puts you in a car with strangers: your email must be confirmed first
    (whenever the server can send the code, see account.verification_required)."""
    if verification_required() and not email_verified(db, user):
        raise HTTPException(403, "Confirm your email first: enter the 6-digit code we sent you.")
    s = db.get(Suspension, user.id)
    if s:
        raise HTTPException(403, "Your community's organiser has paused your account, so you can't post or book rides for now."
                                 + (f" Reason: {s.reason}" if s.reason else ""))
    return user


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
    mobile = checked_mobile(body.mobile)
    if mobile_owner(db, mobile, except_user=user.id):
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
def post_trip(body: TripIn, user: User = Depends(verified_member), db: Session = Depends(get_db)):
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
def request_seat(trip_id: int, body: SeatRequestIn, user: User = Depends(verified_member), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.request_seat, body.pickup_name, body.pickup_lat, body.pickup_lon, body.seats,
                   body.drop_name, body.drop_lat, body.drop_lon)


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


@router.post("/trips/{trip_id}/seats/{seat_id}/no-show", summary="Driver: this rider wasn't at their pickup (from the planned time)")
def no_show(trip_id: int, seat_id: int, user: User = Depends(rider_or_driver), db: Session = Depends(get_db)):
    return _action(trip_id, user, db, T.no_show, seat_id)


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
def broadcast(tenant_id: int, body: BroadcastIn, db: Session = Depends(get_db), actor: Actor | None = Depends(admin_actor)):
    ids = audience_ids(db, tenant_id, body.audience)
    for uid in ids:
        T.alert(db, uid, "broadcast", body.title, body.body)
    db.add(Broadcast(tenant_id=tenant_id, title=body.title, body=body.body, audience=body.audience, sent=len(ids),
                     sent_by=actor.user.id if actor else None))
    db.commit()
    return {"sent": len(ids)}


def audience_ids(db: Session, tenant_id: int, audience: str) -> list[int]:
    """Members of the community a broadcast goes to. Drivers: a car saved in the app."""
    members = select(User.id).where(User.tenant_id == tenant_id, User.role == "member")
    drivers = select(Car.user_id)
    if audience == "drivers":
        members = members.where(User.id.in_(drivers))
    elif audience == "riders":
        members = members.where(User.id.not_in(drivers))
    elif audience == "new":   # hasn't shared a ride yet, either side
        rode = select(TripSeat.rider_id).where(TripSeat.status.in_(("boarded", "dropped")))
        drove = select(Trip.driver_id).where(Trip.status.in_(("started", "completed")))
        members = members.where(User.id.not_in(rode), User.id.not_in(drove))
    return list(db.scalars(members))


@router.get("/tenants/{tenant_id}/broadcasts", summary="Organiser: notifications sent to members, newest first, and audience sizes")
def broadcasts(tenant_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    rows = db.scalars(select(Broadcast).where(Broadcast.tenant_id == tenant_id).order_by(Broadcast.id.desc()).limit(30))
    return {"audiences": {a: len(audience_ids(db, tenant_id, a)) for a in ("all", "drivers", "riders", "new")},
            "sent": [{"id": b.id, "title": b.title, "body": b.body, "audience": b.audience, "sent": b.sent,
                      "read": broadcast_reads(db, tenant_id, b), "created_at": T.utc(b.created_at).isoformat()} for b in rows]}


def broadcast_reads(db: Session, tenant_id: int, b: Broadcast) -> int:
    """How many of the people it went to have opened it. A broadcast's alerts are written in the same request,
    just before its row, so they are the community's broadcast alerts with its title and body from that moment."""
    at = b.created_at
    return db.scalar(select(func.count(Alert.id)).join(User, User.id == Alert.user_id).where(
        User.tenant_id == tenant_id, Alert.kind == "broadcast", Alert.title == b.title[:160], Alert.body == b.body[:400],
        Alert.read.is_(True), Alert.created_at.between(at - timedelta(minutes=1), at + timedelta(seconds=5)))) or 0


# ---------- organiser: pause a member ----------
def _suspension_out(db: Session, s: Suspension) -> dict:
    reports = db.scalar(select(func.count(Report.id)).where(Report.reported_id == s.user_id)) or 0
    return {**T.person(db, s.user_id), "reason": s.reason, "report_id": s.report_id, "reports": reports, "since": T.utc(s.created_at).isoformat()}


@router.get("/tenants/{tenant_id}/suspensions", summary="Organiser: members who can't post or book rides for now")
def suspensions(tenant_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    rows = db.scalars(select(Suspension).where(Suspension.tenant_id == tenant_id).order_by(Suspension.created_at.desc()))
    return [_suspension_out(db, s) for s in rows]


@router.post("/tenants/{tenant_id}/suspensions", status_code=201,
             summary="Organiser: pause a member (no new rides; rides under way carry on). They get an alert.")
def suspend(tenant_id: int, body: SuspendIn, db: Session = Depends(get_db), actor: Actor | None = Depends(admin_actor)):
    user = db.get(User, body.user_id)
    if not user or user.tenant_id != tenant_id or user.role != "member":
        raise HTTPException(404, "Member not found in this community.")
    report = db.get(Report, body.report_id) if body.report_id else None
    if body.report_id and (not report or report.tenant_id != tenant_id or report.reported_id != user.id):
        raise HTTPException(404, "Report not found for this member.")
    s = db.get(Suspension, user.id) or Suspension(user_id=user.id, tenant_id=tenant_id)
    s.reason, s.report_id, s.suspended_by = body.reason.strip(), body.report_id, actor.user.id if actor else None
    db.add(s)
    if report:
        report.status = "reviewed"
    T.alert(db, user.id, "account", "Your account is paused",
            "Your community's organiser has paused your account: you can't post or book new rides for now."
            + (f" Reason: {s.reason}" if s.reason else ""))
    db.commit()
    return _suspension_out(db, s)


@router.delete("/tenants/{tenant_id}/suspensions/{user_id}", summary="Organiser: lift a pause; the member gets an alert")
def unsuspend(tenant_id: int, user_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    s = db.get(Suspension, user_id)
    if not s or s.tenant_id != tenant_id:
        raise HTTPException(404, "This member isn't paused.")
    db.delete(s)
    T.alert(db, user_id, "account", "Your account is active again", "You can post and book rides again.")
    db.commit()
    return {"ok": True}


def _rates_out(r: pricing.Rates) -> dict:
    return {"suggested_per_km": r.suggested_per_km, "car_cost_per_km": r.car_cost_per_km, "min_contribution": r.min_contribution}


def _pricing_out(db: Session, tenant_id: int, admin: bool) -> dict:
    history = T.pricing_history(db, tenant_id)
    out = {**_rates_out(T.current_rates(db, tenant_id)), "defaults": _rates_out(pricing.DEFAULT),
           "changed_at": T.utc(history[-1].created_at).isoformat() if history else None}
    if admin:
        names = {u.id: u.email for u in db.scalars(select(User).where(User.id.in_({h.changed_by for h in history if h.changed_by})))}
        out["history"] = [{**_rates_out(T.rates_from(h)), "changed_at": T.utc(h.created_at).isoformat(), "changed_by": names.get(h.changed_by)}
                          for h in reversed(history[-10:])]
    return out


@router.get("/tenants/{tenant_id}/pricing", summary="The community's cost-sharing rates (organisers also see the changes)")
def get_pricing(tenant_id: int, db: Session = Depends(get_db), actor: Actor = Depends(member_actor)):
    return _pricing_out(db, tenant_id, actor.is_admin)


@router.put("/tenants/{tenant_id}/pricing", summary="Organiser: change the cost-sharing rates for rides posted from now on")
def set_pricing(tenant_id: int, body: PricingIn, db: Session = Depends(get_db), actor: Actor | None = Depends(admin_actor)):
    if body.suggested_per_km > body.car_cost_per_km:
        raise HTTPException(422, "The suggested rate can't be more than what the car costs to run per km. "
                                 "FellaRide is cost-sharing only.")
    db.add(CommunityPricing(tenant_id=tenant_id, suggested_per_km=round(body.suggested_per_km, 2),
                            car_cost_per_km=round(body.car_cost_per_km, 2), min_contribution=body.min_contribution,
                            changed_by=actor.user.id if actor else None))
    db.commit()
    return _pricing_out(db, tenant_id, True)


@router.get("/tenants/{tenant_id}/live", summary="Organiser: rides on the road now (a demo community replays its latest rides, marked simulated)")
def live_rides(tenant_id: int, db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor)):
    return live.live(db, db.get(Tenant, tenant_id))


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
