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
    status: Mapped[str] = mapped_column(String(12), default="open")   # open | full | completed | cancelled | unfilled


class RideRequest(Base):
    __tablename__ = "ride_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    rider_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    destination_id: Mapped[int] = mapped_column(ForeignKey("destinations.id"))
    day: Mapped[int] = mapped_column(Integer, index=True)
    depart_min: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="open")   # open | matched | completed | cancelled | expired


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
