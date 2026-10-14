"""Request bodies. Every field is bounded so bad input is rejected with a clear 422."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Lat = Field(ge=-90, le=90)
Lon = Field(ge=-180, le=180)
Minutes = Field(ge=0, le=1439, description="Minutes after midnight, e.g. 480 = 08:00")


class DestinationIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lat: float = Lat
    lon: float = Lon


Email = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Password = Field(min_length=8, max_length=72, description="8 to 72 characters")
PersonName = Field(min_length=2, max_length=80, pattern=r"^[^<>{}\[\]\\/]+$")


class AdminIn(BaseModel):
    name: str = PersonName
    email: str = Email
    password: str = Password


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["university", "corporate", "residential", "alumni", "professional"] = "university"
    center_lat: float = Lat
    center_lon: float = Lon
    destinations: list[DestinationIn] = Field(min_length=1, max_length=20)
    admin: AdminIn | None = Field(None, description="The organiser's account; required unless called with the operator key")


class DemoCreate(BaseModel):
    seed_active: int = Field(15, ge=5, le=40, description="Members active on day 0")
    seed: int = Field(7, ge=0, le=10_000)


class MemberImport(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str | None = Field(None, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
                              description="Lets this person claim their record when they sign up")
    area: str = Field("", max_length=80)
    home_lat: float = Lat
    home_lon: float = Lon
    destination_id: int
    depart_min: int = Minutes
    has_car: bool = False
    seats: int = Field(0, ge=0, le=8)
    ride_pref: Literal["quiet", "music", "any"] = "any"


class MemberImportBatch(BaseModel):
    members: list[MemberImport] = Field(min_length=1, max_length=2000)


class OfferIn(BaseModel):
    member_id: int | None = Field(None, description="Defaults to the signed-in member; admins may set it")
    depart_min: int | None = Field(None, ge=0, le=1439)
    seats: int | None = Field(None, ge=1, le=8)


class RequestIn(BaseModel):
    member_id: int | None = Field(None, description="Defaults to the signed-in member; admins may set it")
    depart_min: int | None = Field(None, ge=0, le=1439)
    preferred_driver_id: int | None = Field(None, description="The driver the rider asked for, if any")


class FinishIn(BaseModel):
    completed: bool


class PlanIn(BaseModel):
    budget: int | None = Field(None, ge=1, le=200)
    strategy: Literal["smart", "random"] = "smart"
    connectors_first: bool = True


class RespondIn(BaseModel):
    responded: bool


class ReferralIn(BaseModel):
    inviter_id: int | None = Field(None, description="Defaults to the signed-in member")
    invitee_id: int


class SimulateIn(BaseModel):
    days: int = Field(10, ge=1, le=90)
    strategy: Literal["smart", "random"] = "smart"
    budget: int = Field(14, ge=1, le=100)
    connectors_first: bool = True
    referrals_on: bool = True
    learning_on: bool = True
    seed: int = Field(11, ge=0, le=10_000)


class CompareIn(BaseModel):
    days: int = Field(40, ge=5, le=90)
    seed_active: int = Field(15, ge=5, le=40)
    budget: int = Field(14, ge=1, le=100)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200, description="Email or mobile number")
    password: str = Field(min_length=1, max_length=72)


class DemoLoginIn(BaseModel):
    tenant_id: int
    member_id: int


class RegisterIn(BaseModel):
    """Join a community with its join code and set up your commute in one step."""
    join_code: str = Field(min_length=4, max_length=16, pattern=r"^[A-Za-z0-9]+$")
    name: str = PersonName
    email: str = Email
    password: str = Password
    area: str = Field("", max_length=80, pattern=r"^[^<>{}]*$")
    home_lat: float = Lat
    home_lon: float = Lon
    destination_id: int
    depart_min: int = Minutes
    has_car: bool = False
    seats: int = Field(0, ge=0, le=8)
    ride_pref: Literal["quiet", "music", "any"] = "any"


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=6)
    comment: str = Field("", max_length=280)


class ReadIn(BaseModel):
    ids: list[int] | None = Field(None, max_length=200, description="Omit to mark everything as read")


# ---------- Sprint 3: sign-up without a community, trips, ratings, reports ----------
Mobile = Field(min_length=7, max_length=20, pattern=r"^\+?[0-9][0-9 \-]{5,18}[0-9]$", description="e.g. +91 98765 43210")
Gender = Literal["female", "male", "other", "unsaid"]
Place = Field(min_length=1, max_length=160, pattern=r"^[^<>{}]+$")


class SignupIn(BaseModel):
    name: str = PersonName
    gender: Gender
    email: str = Email
    mobile: str = Mobile
    password: str = Password
    join_code: str | None = Field(None, max_length=16, pattern=r"^[A-Za-z0-9]*$", description="Optional community code")


class ProfileIn(BaseModel):
    name: str = PersonName
    gender: Gender
    mobile: str = Mobile


class LocationIn(BaseModel):
    lat: float = Lat
    lon: float = Lon


class TripIn(BaseModel):
    from_name: str = Place
    from_lat: float = Lat
    from_lon: float = Lon
    to_name: str = Place
    to_lat: float = Lat
    to_lon: float = Lon
    depart_at: datetime = Field(description="When you leave, ISO 8601 with a time zone")
    route: list[tuple[float, float]] = Field(min_length=2, max_length=400, description="The confirmed route, [[lat, lon], ...]")
    route_km: float = Field(ge=0, le=2000)
    route_min: int = Field(ge=0, le=3000)
    seats: int = Field(ge=1, le=8)


class SeatRequestIn(BaseModel):
    pickup_name: str = Field("", max_length=160, pattern=r"^[^<>{}]*$")
    pickup_lat: float | None = Field(None, ge=-90, le=90)
    pickup_lon: float | None = Field(None, ge=-180, le=180)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=500)


class RatingIn(BaseModel):
    to_id: int
    stars: int = Field(ge=1, le=5)
    comment: str = Field("", max_length=280)


class ReportIn(BaseModel):
    trip_id: int
    reported_id: int
    reasons: list[str] = Field(min_length=1, max_length=15)
    note: str = Field("", max_length=500)


class InviteIn(BaseModel):
    name: str = PersonName
    email: str = Email


class BroadcastIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field("", max_length=400)


# ---------- community board ----------
class PostIn(BaseModel):
    kind: Literal["update", "ask", "offer", "thanks", "tip"] = "update"
    body: str = Field(min_length=1, max_length=500)


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=300)


class ReactionIn(BaseModel):
    emoji: Literal["thumbs", "heart", "party", "thanks"]


# ---------- network expansion ----------
class ExpansionRunIn(BaseModel):
    max_actions: int = Field(3, ge=1, le=8)


class AutopilotIn(BaseModel):
    days: int = Field(5, ge=1, le=30)
    seed: int = Field(31, ge=0, le=10_000)


class CorridorIn(BaseModel):
    community_id: int = Field(ge=1)
    corridor: str = Field(min_length=3, max_length=40, description="A shared corridor's id from the expansion report")
