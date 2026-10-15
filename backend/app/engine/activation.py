"""Activation bridge: the member app's rides feed the activation engine.

The member app (trips.py) works on users and real datetimes; the engine works on members and the community's
day clock. This module is the only place that connects them, so a real ride moves the same funnel, KPIs, growth
graph and model weights as an engine ride does:

    sign-up / first ride action -> Member created or claimed, registered (Discover -> Register)
    post a ride / ask for a seat -> first interaction; a recent nudge counts as answered (Nudge -> Learn)
    ride ends with riders on board -> first / repeat ride, co-ride edges, positive examples (Ride -> Learn -> Grow)
    rider left behind, ride cancelled -> weak negative example for the driver model
    rating -> the author's role model learns, as with engine ride feedback
    invite accepted (sign-up with the invited email) -> referral joined, inviter becomes a referrer (Refer)

Every hook is idempotent, does nothing for organiser accounts, stamps engine data with `tenant.current_day`
(never wall-clock time), and runs through `safe()` so a bridge failure never breaks the ride action.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (Alert, Destination, Event, Intervention, Member, MemberState, Profile, Rating, Referral, Tenant,
                      Trip, TripSeat, User)
from . import daycycle, interventions, lifecycle, referrals, scorer
from .context import build_context
from .geo import haversine_km
from .rides import _link

log = logging.getLogger("fellaride.activation")

DEST_MERGE_KM = 1.5          # a new drop point this close to a known destination reuses it
COMMUTE_RADIUS_KM = 50       # rides further than this from the community centre still count, but aren't a commute
DEFAULT_DEPART_MIN = 480     # 08:00 until a real ride says otherwise
LOCAL_TZ = daycycle.LOCAL_TZ


def safe(db: Session, fn, *args) -> None:
    """Run a bridge hook in a savepoint. On failure only the hook's own writes are undone and the error is
    logged, so the ride action still succeeds. With FELLARIDE_ACTIVATION_STRICT (tests) errors are raised."""
    try:
        with db.begin_nested():
            fn(db, *args)
    except Exception:
        if get_settings().activation_strict:
            raise
        log.exception("Activation bridge failed in %s", getattr(fn, "__name__", fn))


# ---------- helpers ----------
def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def local_minutes(dt: datetime) -> int:
    """Minutes after local midnight, the engine's departure-time unit."""
    d = _utc(dt).astimezone(LOCAL_TZ)
    return d.hour * 60 + d.minute


def _tenant_for(db: Session, user: User | None) -> Tenant | None:
    if user is None or user.role != "member":
        return None
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is not None:
        daycycle.catch_up(db, tenant)
    return tenant


def _event(db: Session, tenant: Tenant, member: Member | None, type_: str, **payload) -> None:
    db.add(Event(tenant_id=tenant.id, member_id=member.id if member else None, day=tenant.current_day, type=type_,
                 payload={**payload, "source": "app"}))


def in_area(tenant: Tenant, lat: float, lon: float) -> bool:
    """Is this point part of the community's daily commute area? The open community has no fixed area."""
    return tenant.kind == "public" or haversine_km(lat, lon, tenant.center_lat, tenant.center_lon) <= COMMUTE_RADIUS_KM


def _place(name: str) -> str:
    return (name or "").split(",")[0].strip()[:80]


def ensure_destination(db: Session, tenant: Tenant, name: str, lat: float, lon: float) -> Destination:
    """Reuse this community's destination within DEST_MERGE_KM, else add one (the open community starts with none)."""
    known = list(db.scalars(select(Destination).where(Destination.tenant_id == tenant.id)))
    near = min(known, key=lambda d: haversine_km(lat, lon, d.lat, d.lon), default=None)
    if near and haversine_km(lat, lon, near.lat, near.lon) <= DEST_MERGE_KM:
        return near
    d = Destination(tenant_id=tenant.id, name=_place(name) or "Destination", lat=lat, lon=lon)
    db.add(d)
    db.flush()
    return d


# ---------- identity: discover -> register ----------
def claimable_member(db: Session, tenant: Tenant, email: str) -> Member | None:
    """A discovered member of this community with this email that no account has claimed yet."""
    linked = exists(select(User.id).where(User.member_id == Member.id))
    return db.scalar(select(Member).where(Member.tenant_id == tenant.id, func.lower(Member.email) == email.strip().lower(),
                                          ~linked).order_by(Member.id).limit(1))


def register_member(db: Session, tenant: Tenant, member: Member, via: str) -> None:
    """Mark a member as joined. A pending invite to them converts first, so the inviter becomes a referrer."""
    pending = list(db.scalars(select(Referral).where(Referral.invitee_id == member.id, Referral.status == "sent")
                              .order_by(Referral.id)))
    if pending:
        referrals.accept(db, tenant, pending[0])
        for other in pending[1:]:
            other.status = "expired"
    lifecycle.mark_registered(db, member, tenant.current_day, via=via)


def ensure_member(db: Session, user: User | None, *, home: tuple[float, float, str] | None = None,
                  dest: tuple[str, float, float] | None = None, depart_at: datetime | None = None,
                  seats: int | None = None, create: bool = True) -> Member | None:
    """The user's engine member, claimed or created on first need. Hints from a real ride (home = start or pickup,
    dest = drop) keep a real member's commute up to date; `seats` marks them as a driver.
    create=False only claims an existing record. Returns None for organisers, or with nothing to anchor a
    destination to yet (the open community before your first ride)."""
    tenant = _tenant_for(db, user)
    if tenant is None:
        return None
    # a one-off trip far away (a holiday, the airport in another city) counts as a ride, not as the commute
    home = home if home and in_area(tenant, home[0], home[1]) else None
    dest = dest if dest and in_area(tenant, dest[1], dest[2]) else None
    m = db.get(Member, user.member_id) if user.member_id else None
    if m is None and (m := claimable_member(db, tenant, user.email)) is not None:
        user.member_id = m.id
        register_member(db, tenant, m, via="claimed")
    if m is None and not create:
        return None
    if m is None:
        d = ensure_destination(db, tenant, *dest) if dest else db.scalar(
            select(Destination).where(Destination.tenant_id == tenant.id).order_by(Destination.id).limit(1))
        if d is None:
            return None
        p = db.get(Profile, user.id)
        lat, lon = (home[0], home[1]) if home else (tenant.center_lat, tenant.center_lon)
        m = Member(tenant_id=tenant.id, name=(p.name if p else user.email.split("@")[0])[:120], email=user.email,
                   area=_place(home[2]) if home else "", home_lat=lat, home_lon=lon, destination_id=d.id,
                   depart_min=local_minutes(depart_at) if depart_at else DEFAULT_DEPART_MIN,
                   state=MemberState.DISCOVERED, is_synthetic=False)
        db.add(m)
        db.flush()
        user.member_id = m.id
        register_member(db, tenant, m, via="app")
        daycycle.refresh_connectors(db, tenant)
    elif not m.is_synthetic and (home or dest):   # a real member's commute follows their latest local ride
        if home:
            m.home_lat, m.home_lon, m.area = home[0], home[1], _place(home[2]) or m.area
        if dest:
            m.destination_id = ensure_destination(db, tenant, *dest).id
        if depart_at:
            m.depart_min = local_minutes(depart_at)
    if seats:
        m.has_car, m.seats, m.role_pref = True, max(m.seats, seats), "both"
    db.flush()
    return m


def member_of(db: Session, user_id: int | None) -> Member | None:
    u = db.get(User, user_id) if user_id else None
    return db.get(Member, u.member_id) if u and u.member_id else None


# ---------- nudges: the app answers them ----------
def attribute_nudge(db: Session, tenant: Tenant, member: Member) -> Intervention | None:
    """A ride action soon after a nudge counts as a yes: the model learns, without creating engine rides."""
    since = tenant.current_day - get_settings().nudge_cooldown_days
    iv = db.scalar(select(Intervention).where(Intervention.member_id == member.id, Intervention.status == "sent",
                                              Intervention.day >= since).order_by(Intervention.id.desc()).limit(1))
    if iv is None:
        return None
    interventions.respond(db, tenant, iv, True, follow_up=False)
    user_id = db.scalar(select(User.id).where(User.member_id == member.id))
    for a in db.scalars(select(Alert).where(Alert.user_id == user_id, Alert.kind.like("nudge%"), Alert.read.is_(False))):
        a.read = True
    return iv


# ---------- hooks called from trips.py ----------
def on_signup(db: Session, user: User, with_code: bool) -> None:
    """An invited or imported person claims their record. With a join code you're registered right away
    (community centre and first destination until your first ride); without one, at your first ride."""
    ensure_member(db, user, create=with_code)


# ---------- invites from the app (Refer) ----------
MAX_PENDING_INVITES = 10


def invite_by_email(db: Session, user: User, name: str, email: str) -> Referral:
    """Invite someone by email: they become a discovered member of your community, and when they sign up
    with this email the invite converts and you become a referrer."""
    tenant = _tenant_for(db, user)
    if tenant is None:
        raise referrals.ReferralError("Organiser accounts can't send invites.")
    inviter = ensure_member(db, user)
    if inviter is None:
        raise referrals.ReferralError("Post or join a ride first, then you can invite people.")
    email = email.strip().lower()
    if email == user.email:
        raise referrals.ReferralError("You can't invite yourself.")
    if db.scalar(select(User.id).where(User.email == email)):
        raise referrals.ReferralError("That person already has a FellaRide account.")
    pending = db.scalar(select(func.count(Referral.id)).where(Referral.inviter_id == inviter.id, Referral.status == "sent"))
    if pending >= MAX_PENDING_INVITES:
        raise referrals.ReferralError(f"You have {pending} invites waiting. Wait for some to join first.")
    invitee = db.scalar(select(Member).where(Member.tenant_id == tenant.id, func.lower(Member.email) == email).limit(1))
    if invitee is None:   # assume they commute like you until their own first ride says otherwise
        invitee = Member(tenant_id=tenant.id, name=name.strip()[:120], email=email, area="", home_lat=inviter.home_lat,
                         home_lon=inviter.home_lon, destination_id=inviter.destination_id, depart_min=inviter.depart_min,
                         state=MemberState.DISCOVERED, is_synthetic=False)
        db.add(invitee)
        db.flush()
        _event(db, tenant, invitee, "member_discovered", via="invite", inviter=inviter.id)
    return referrals.send(db, tenant, inviter, invitee)


def credit_referral(db: Session, referrer: User, referred: User) -> None:
    """Someone signed up through a member's referral link: the engine sees a converted referral, so the
    referrer counts in the funnel ("Brought someone in") and the growth graph gets a referral edge."""
    tenant = _tenant_for(db, referred)
    inviter, invitee = member_of(db, referrer.id), member_of(db, referred.id)
    if tenant is None or inviter is None or invitee is None or inviter.id == invitee.id:
        return
    if db.scalar(select(Referral.id).where(Referral.invitee_id == invitee.id, Referral.status == "joined")):
        return
    db.add(Referral(tenant_id=tenant.id, inviter_id=inviter.id, invitee_id=invitee.id, day=tenant.current_day,
                    source="link", status="joined"))
    invitee.invited_by_id = inviter.id
    lifecycle.mark_referrer(db, inviter, tenant.current_day)
    _event(db, tenant, inviter, "referral_joined", invitee_id=invitee.id, via="link")
    db.flush()


def on_trip_posted(db: Session, trip: Trip, user: User) -> None:
    m = ensure_member(db, user, home=(trip.from_lat, trip.from_lon, trip.from_name),
                      dest=(trip.to_name, trip.to_lat, trip.to_lon), depart_at=trip.depart_at, seats=trip.seats_total)
    if m is None:
        return
    tenant = db.get(Tenant, m.tenant_id)
    lifecycle.mark_interacted(db, m, tenant.current_day, "posted_trip")
    _event(db, tenant, m, "trip_posted", trip_id=trip.id)
    attribute_nudge(db, tenant, m)


def on_seat_requested(db: Session, trip: Trip, seat: TripSeat, user: User) -> None:
    home = (seat.pickup_lat, seat.pickup_lon, seat.pickup_name) if seat.pickup_lat is not None else (
        trip.from_lat, trip.from_lon, trip.from_name)
    m = ensure_member(db, user, home=home, dest=(trip.to_name, trip.to_lat, trip.to_lon), depart_at=trip.depart_at)
    if m is None:
        return
    tenant = db.get(Tenant, m.tenant_id)
    lifecycle.mark_interacted(db, m, tenant.current_day, "requested_seat")
    _event(db, tenant, m, "seat_requested", trip_id=trip.id)
    attribute_nudge(db, tenant, m)


def _already_counted(db: Session, tenant: Tenant, driver: Member, trip_id: int) -> bool:
    payloads = db.scalars(select(Event.payload).where(Event.tenant_id == tenant.id, Event.member_id == driver.id,
                                                      Event.type.in_(("ride_completed", "trip_unfilled"))))
    return any(p.get("source") == "app" and p.get("trip_id") == trip_id for p in payloads)


def on_trip_finished(db: Session, trip: Trip) -> None:
    """A ride ended: everyone who travelled gets a (first / repeat) ride, a co-ride edge, and the models learn."""
    driver = ensure_member(db, db.get(User, trip.driver_id))
    if driver is None:
        return
    tenant = db.get(Tenant, trip.tenant_id)
    if _already_counted(db, tenant, driver, trip.id):
        return
    rows = list(db.scalars(select(TripSeat).where(TripSeat.trip_id == trip.id)))
    riders = [m for s in rows if s.status == "dropped" and (m := ensure_member(db, db.get(User, s.rider_id)))]
    missed = sum(1 for s in rows if s.status == "missed")
    weights, lr = scorer.tenant_weights(db, tenant), get_settings().learning_rate
    ctx = build_context(db, tenant)     # features as they were before this ride, like the engine's finish_offer
    for _ in range(missed):             # someone was left behind: weak negative for the driver
        scorer.learn(weights["driver"], ctx.features(driver), 0, lr, 0.25)
    if not riders:
        _event(db, tenant, driver, "trip_unfilled", trip_id=trip.id)
        return
    scorer.learn(weights["driver"], ctx.features(driver), 1, lr, 0.5)
    for r in riders:
        scorer.learn(weights["rider"], ctx.features(r), 1, lr, 0.5)
    day = tenant.current_day
    for m in [driver, *riders]:
        lifecycle.mark_ride_completed(db, m, day)
    for i, r in enumerate(riders):
        _link(db, tenant.id, driver.id, r.id, day)
        for other in riders[i + 1:]:
            _link(db, tenant.id, r.id, other.id, day)
        db.flush()
    _event(db, tenant, driver, "ride_completed", trip_id=trip.id, riders=[r.id for r in riders])


def on_trip_cancelled(db: Session, trip: Trip, had_approved: bool) -> None:
    driver = member_of(db, trip.driver_id)
    if driver is None:
        return
    tenant = db.get(Tenant, trip.tenant_id)
    if had_approved:   # riders were counting on this ride
        ctx = build_context(db, tenant)
        scorer.learn(scorer.tenant_weights(db, tenant)["driver"], ctx.features(driver), 0,
                     get_settings().learning_rate, 0.25)
    _event(db, tenant, driver, "ride_cancelled", trip_id=trip.id, had_approved=had_approved)


def on_rating(db: Session, trip: Trip, rating: Rating) -> None:
    """Same learning as engine ride feedback: a happy author is a weak positive for their role on this ride."""
    author, about = member_of(db, rating.from_id), member_of(db, rating.to_id)
    if author is None or about is None:
        return
    tenant = db.get(Tenant, trip.tenant_id)
    if rating.stars != 3:
        role = "driver" if rating.from_id == trip.driver_id else "rider"
        ctx = build_context(db, tenant)
        scorer.learn(scorer.tenant_weights(db, tenant)[role], ctx.features(author), 1 if rating.stars >= 4 else 0,
                     get_settings().learning_rate, 0.25)
    _event(db, tenant, author, "ride_rated", trip_id=trip.id, rating=rating.stars, about=about.id)
