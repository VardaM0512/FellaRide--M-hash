"""Database tables.

Time model: every tenant has an engine clock `current_day` (days since the community launched).
Rides, nudges and metrics are stamped with that day. In production the clock advances once per
calendar day; in demos `/simulate` advances it many days at once.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemberState:
    """Activation lifecycle (matches the Member Activation Journey diagram)."""

    DISCOVERED = "discovered"      # found via public signals, not signed up
    REGISTERED = "registered"      # signed up, no interaction yet
    INTERACTED = "interacted"      # responded to a nudge / viewed or posted a ride
    FIRST_RIDE = "first_ride"      # completed one ride
    REPEAT = "repeat"              # completed two or more rides
    REFERRER = "referrer"          # brought in at least one member who joined

    ORDER = [DISCOVERED, REGISTERED, INTERACTED, FIRST_RIDE, REPEAT, REFERRER]


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(40), default="university")
    center_lat: Mapped[float] = mapped_column(Float)
    center_lon: Mapped[float] = mapped_column(Float)
    current_day: Mapped[int] = mapped_column(Integer, default=0)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    # members join a community with this code (shared by the organiser)
    join_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    destinations: Mapped[list["Destination"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class Destination(Base):
    __tablename__ = "destinations"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)

    tenant: Mapped[Tenant] = relationship(back_populates="destinations")


class Member(Base):
    __tablename__ = "members"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    area: Mapped[str] = mapped_column(String(80), default="")
    home_lat: Mapped[float] = mapped_column(Float)
    home_lon: Mapped[float] = mapped_column(Float)
    destination_id: Mapped[int] = mapped_column(ForeignKey("destinations.id"))
    depart_min: Mapped[int] = mapped_column(Integer)                 # minutes after midnight, e.g. 480 = 08:00
    has_car: Mapped[bool] = mapped_column(Boolean, default=False)
    seats: Mapped[int] = mapped_column(Integer, default=0)
    role_pref: Mapped[str] = mapped_column(String(20), default="passenger")   # driver | passenger | both
    ride_pref: Mapped[str] = mapped_column(String(20), default="any")         # quiet | music | any
    available_days: Mapped[str] = mapped_column(String(40), default="Mon-Fri")
    state: Mapped[str] = mapped_column(String(20), default=MemberState.DISCOVERED, index=True)
    is_connector: Mapped[bool] = mapped_column(Boolean, default=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    # funnel timestamps (engine day)
    registered_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interacted_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    first_ride_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    referrer_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # activity counters
    rides_count: Mapped[int] = mapped_column(Integer, default=0)
    last_ride_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nudges_received: Mapped[int] = mapped_column(Integer, default=0)
    nudges_responded: Mapped[int] = mapped_column(Integer, default=0)
    last_nudged_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    invited_by_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True)

    destination: Mapped[Destination] = relationship()


class Connection(Base):
    """Edges of the growth graph. kind = social (known tie) or co_ride (rode together)."""

    __tablename__ = "connections"
    __table_args__ = (UniqueConstraint("a_id", "b_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    a_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)   # always the smaller id
    b_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="social")
    weight: Mapped[int] = mapped_column(Integer, default=1)
    since_day: Mapped[int] = mapped_column(Integer, default=0)


class SyntheticTrait(Base):
    """Hidden behaviour of SYNTHETIC members, used only by the simulator. Never read by the engine."""

    __tablename__ = "synthetic_traits"
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), primary_key=True)
    t_drive: Mapped[float] = mapped_column(Float)
    t_ride: Mapped[float] = mapped_column(Float)
    t_refer: Mapped[float] = mapped_column(Float)
    responsiveness: Mapped[float] = mapped_column(Float)


class RideOffer(Base):
    __tablename__ = "ride_offers"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    destination_id: Mapped[int] = mapped_column(ForeignKey("destinations.id"))
    day: Mapped[int] = mapped_column(Integer, index=True)
    depart_min: Mapped[int] = mapped_column(Integer)
    seats_total: Mapped[int] = mapped_column(Integer)
    seats_left: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="open")   # open | full | started | completed | cancelled | unfilled


class RideRequest(Base):
    __tablename__ = "ride_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    rider_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    destination_id: Mapped[int] = mapped_column(ForeignKey("destinations.id"))
    day: Mapped[int] = mapped_column(Integer, index=True)
    depart_min: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="open")   # open | matched | completed | cancelled | expired
    # the driver the rider asked for (from a named suggestion or a partner card); matching prefers this pair
    preferred_driver_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True)


class Booking(Base):
    """A rider seated in a driver's ride (the outcome of a match)."""

    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("ride_offers.id"), index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("ride_requests.id"))
    driver_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    rider_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    day: Mapped[int] = mapped_column(Integer, index=True)
    score: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(12), default="booked")  # booked | completed | cancelled


class Intervention(Base):
    """One action the Intervention Engine chose for one member (a nudge, an invite ask, ...)."""

    __tablename__ = "interventions"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    day: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(20))        # driver | rider | connector | reactivate | generic
    role: Mapped[str] = mapped_column(String(20))        # which propensity model this outcome trains
    strategy: Mapped[str] = mapped_column(String(10))    # smart | random
    message: Mapped[str] = mapped_column(String(300))
    suggested_member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True)
    priority: Mapped[float] = mapped_column(Float, default=0.0)
    features: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(12), default="sent")  # sent | responded | ignored


class Referral(Base):
    __tablename__ = "referrals"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    inviter_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    invitee_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    day: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(12), default="referral")  # referral | connector
    status: Mapped[str] = mapped_column(String(10), default="sent")      # sent | joined | expired


class Event(Base):
    """Append-only activity log (the 'Activity Events' stream in the architecture)."""

    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True, index=True)
    day: Mapped[int] = mapped_column(Integer, index=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ModelState(Base):
    """Per-tenant online weights of the propensity model, initialised from scorer.pkl."""

    __tablename__ = "model_states"
    __table_args__ = (UniqueConstraint("tenant_id", "role"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    weights: Mapped[list] = mapped_column(JSON)
    updates: Mapped[int] = mapped_column(Integer, default=0)


class DailyMetric(Base):
    __tablename__ = "daily_metrics"
    __table_args__ = (UniqueConstraint("tenant_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    day: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)


class User(Base):
    """A login. Members sign in to act as their own member record; admins run their community."""

    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"), nullable=True, unique=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10), default="member")   # member | admin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base):
    """In-app messages: matched, ride started, ride finished, rate your ride, seat wanted, no match today."""

    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    day: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String(400), default="")
    offer_id: Mapped[int | None] = mapped_column(ForeignKey("ride_offers.id"), nullable=True)
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RideFeedback(Base):
    """One rating per person per shared ride (rider rates driver, driver rates each rider)."""

    __tablename__ = "ride_feedback"
    __table_args__ = (UniqueConstraint("booking_id", "author_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    about_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    day: Mapped[int] = mapped_column(Integer)
    rating: Mapped[int] = mapped_column(Integer)                     # 1..5
    tags: Mapped[list] = mapped_column(JSON, default=list)
    comment: Mapped[str] = mapped_column(String(280), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- Trips: the member app's posted rides (Sprint 3) ----------
# A driver posts a trip (from, to, time, confirmed route, seats). Riders nearby ask for a seat, the driver
# approves or rejects, everyone approved shares one boarding code, the driver marks who got in, and either side
# ends their part. Keyed by user (login), not engine member, so anyone can sign up without a community.

class Profile(Base):
    """What other people see about you: name, gender, mobile (only after a seat is approved), last location."""

    __tablename__ = "profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    mobile: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    gender: Mapped[str] = mapped_column(String(12))               # female | male | other | unsaid
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)   # for "trip near you" alerts
    last_lon: Mapped[float | None] = mapped_column(Float, nullable=True)


class PasswordReset(Base):
    """A one-time forgot-password link. Only a hash of the token is stored, so a leaked database can't reset anyone."""

    __tablename__ = "password_resets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DriverLicence(Base):
    """A driver's own declaration that they hold a valid driving licence, ticked each time they offer a ride.
    The licence itself isn't checked; this records who declared it and when."""

    __tablename__ = "driver_licences"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Car(Base):
    """The car a driver drives: model and colour are shown on their rides, the number plate only to approved riders.
    A table of its own (not columns on profiles), so existing databases pick it up on startup without a migration."""

    __tablename__ = "cars"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    model: Mapped[str] = mapped_column(String(60))                 # e.g. Maruti Swift
    colour: Mapped[str] = mapped_column(String(30))
    plate: Mapped[str] = mapped_column(String(16))                 # e.g. KA 01 AB 1234


class Trip(Base):
    __tablename__ = "trips"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    from_name: Mapped[str] = mapped_column(String(160))
    from_lat: Mapped[float] = mapped_column(Float)
    from_lon: Mapped[float] = mapped_column(Float)
    to_name: Mapped[str] = mapped_column(String(160))
    to_lat: Mapped[float] = mapped_column(Float)
    to_lon: Mapped[float] = mapped_column(Float)
    depart_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    route: Mapped[list] = mapped_column(JSON)                      # [[lat, lon], ...] the driver confirmed
    route_km: Mapped[float] = mapped_column(Float)
    route_min: Mapped[int] = mapped_column(Integer)
    seats_total: Mapped[int] = mapped_column(Integer)
    code: Mapped[str] = mapped_column(String(6))                   # boarding code shared with approved riders
    status: Mapped[str] = mapped_column(String(12), default="open", index=True)  # open | started | completed | cancelled
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TripSeat(Base):
    """One rider's seat request on a trip and where it got to."""

    __tablename__ = "trip_seats"
    __table_args__ = (UniqueConstraint("trip_id", "rider_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    rider_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # pending | approved | rejected | withdrawn | boarded | dropped | missed (driver left without them)
    # | cancelled (approved, then the driver cancelled the ride)
    status: Mapped[str] = mapped_column(String(12), default="pending")
    pickup_name: Mapped[str] = mapped_column(String(160), default="")
    pickup_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    pickup_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TripMessage(Base):
    """Group chat of a trip: the driver and the approved riders."""

    __tablename__ = "trip_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Rating(Base):
    """1 to 5 stars about one person on one trip. from_id is empty for automatic penalties (e.g. left early)."""

    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("trip_id", "from_id", "to_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    from_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    to_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    stars: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(12), default="peer")   # peer | left_early | cancelled
    comment: Mapped[str] = mapped_column(String(280), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id", ondelete="SET NULL"), nullable=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reported_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    reasons: Mapped[list] = mapped_column(JSON)
    category: Mapped[str] = mapped_column(String(16), index=True)   # safety | fraud | reliability | conduct | other
    severity: Mapped[str] = mapped_column(String(8))                # high | medium | low
    note: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | reviewed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Alert(Base):
    """In-app notification for a user (trip near you, seat request, approved, got in, ended, broadcast ...)."""

    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String(400), default="")
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------- Community board: posts, reactions and comments ----------
# Authored by a login (user). Seeded demo posts come from synthetic members who have no login, so user_id is
# optional and the author's name is kept with the post.

class CommunityPost(Base):
    __tablename__ = "community_posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    author_name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(12), default="update")   # update | ask | offer | thanks | tip
    body: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class PostReaction(Base):
    __tablename__ = "post_reactions"
    __table_args__ = (UniqueConstraint("post_id", "user_id", "emoji"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("community_posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    emoji: Mapped[str] = mapped_column(String(12))   # thumbs | heart | party | thanks


class PostComment(Base):
    __tablename__ = "post_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("community_posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(80))
    body: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ExpansionAction(Base):
    """One growth action the Network Expansion Engine took (or proposed) for an area, and what came of it.

    target_ids / intervention_ids: the joined members it nudged and the nudges it sent. baseline: the area's
    numbers when the action was taken; outcome: the same numbers when it was evaluated, plus whether it worked.
    """

    __tablename__ = "expansion_actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    day: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(24))      # recruit_drivers | activate_riders | invite_neighbours | reactivate | shared_corridor
    area: Mapped[str] = mapped_column(String(120))
    zones: Mapped[list] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(String(300))
    message: Mapped[str] = mapped_column(String(300), default="")
    target_ids: Mapped[list] = mapped_column(JSON, default=list)
    intervention_ids: Mapped[list] = mapped_column(JSON, default=list)
    expected: Mapped[float] = mapped_column(Float, default=0.0)
    baseline: Mapped[dict] = mapped_column(JSON, default=dict)
    outcome: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(12), default="active")   # active | evaluated | proposed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
