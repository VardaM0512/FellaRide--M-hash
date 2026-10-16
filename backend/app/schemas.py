"""Request bodies. Every field is bounded so bad input is rejected with a clear 422."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

Lat = Field(ge=-90, le=90)
Lon = Field(ge=-180, le=180)
Minutes = Field(ge=0, le=1439, description="Minutes after midnight, e.g. 480 = 08:00")


class DestinationIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lat: float = Lat
    lon: float = Lon


Email = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Password = Field(min_length=8, max_length=72, description="8 to 72 characters")
# Trimmed before the length check, so "   " or " A " can't slip through and be saved as a blank or 1-letter name.
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80, pattern=r"^[^<>{}\[\]\\/]+$")]


class AdminIn(BaseModel):
    name: PersonName
    email: str = Email
    password: str = Password


class CommunityUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]


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


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=72, description="Your current password, to confirm")


class DemoLoginIn(BaseModel):
    tenant_id: int
    member_id: int


class RegisterIn(BaseModel):
    """Join a community with its join code and set up your commute in one step."""
    join_code: str = Field(min_length=4, max_length=16, pattern=r"^[A-Za-z0-9]+$")
    name: PersonName
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
    name: PersonName
    gender: Gender
    email: str = Email
    mobile: str = Mobile
    password: str = Password
    join_code: str | None = Field(None, max_length=16, pattern=r"^[A-Za-z0-9]*$", description="Optional community code")
    referral_code: str | None = Field(None, max_length=12, pattern=r"^[A-Za-z0-9]*$", description="Optional: the code of the friend who invited you")


class ForgotPasswordIn(BaseModel):
    email: str = Email


class ResetPasswordIn(BaseModel):
    """Either the token from the emailed link, or the email address plus the 6-digit code from the same email."""
    token: str | None = Field(None, min_length=20, max_length=200, pattern=r"^[A-Za-z0-9_\-]+$")
    email: str | None = Field(None, min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    code: str | None = Field(None, pattern=r"^[0-9]{6}$")
    password: str = Password

    @model_validator(mode="after")
    def _token_or_code(self):
        if not self.token and not (self.email and self.code):
            raise ValueError("Use the link from the email, or enter your email and the 6-digit code.")
        return self


class SwitchCommunityIn(BaseModel):
    join_code: str | None = Field(None, max_length=16, pattern=r"^[A-Za-z0-9]*$",
                                  description="The code of the community to move to. Empty: the open community for everyone.")


class VerifyEmailIn(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$", description="The 6-digit code from the sign-up email")


class ProfileIn(BaseModel):
    name: PersonName
    gender: Gender
    mobile: str = Mobile


class LocationIn(BaseModel):
    lat: float = Lat
    lon: float = Lon


class CarIn(BaseModel):
    model: str = Field(min_length=2, max_length=60, pattern=r"^[^<>{}\[\]\\]+$", description="e.g. Maruti Swift")
    colour: str = Field(min_length=2, max_length=30, pattern=r"^[^<>{}\[\]\\]+$", description="e.g. White")
    plate: str = Field(min_length=4, max_length=16, pattern=r"^[A-Za-z0-9][A-Za-z0-9 \-]*[A-Za-z0-9]$", description="e.g. KA 01 AB 1234")


UPI_PATTERN = r"^[A-Za-z0-9._\-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$"


class UpiIn(BaseModel):
    upi_id: str = Field("", max_length=80, pattern=r"^$|" + UPI_PATTERN, description="Empty removes it")


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
    car: CarIn | None = Field(None, description="The car you're driving; saved for your next ride")
    licence_confirmed: bool = Field(False, description="The driver ticks that they hold a valid driving licence")
    cost_share_confirmed: bool = Field(False, description="The driver ticks that they are sharing costs, not running a taxi")
    price_per_km: float | None = Field(None, ge=0, le=20, description="Rs per km a rider travels; 0 = free; empty = suggested")
    upi_id: str | None = Field(None, max_length=80, pattern=UPI_PATTERN, description="Where riders can pay you, e.g. name@okbank")


class TrackIn(BaseModel):
    lat: float = Lat
    lon: float = Lon
    heading: float | None = Field(None, ge=0, le=360, description="Direction of travel in degrees, if the phone knows it")
    speed_kmh: float | None = Field(None, ge=0, le=250)


class SeatRequestIn(BaseModel):
    pickup_name: str = Field("", max_length=160, pattern=r"^[^<>{}]*$")
    seats: int = Field(1, ge=1, le=8, description="How many seats you need (you and friends travelling with you)")
    pickup_lat: float | None = Field(None, ge=-90, le=90)
    pickup_lon: float | None = Field(None, ge=-180, le=180)
    drop_name: str = Field("", max_length=160, pattern=r"^[^<>{}]*$")
    drop_lat: float | None = Field(None, ge=-90, le=90, description="Where you get off; you pay up to here (empty: the end of the route)")
    drop_lon: float | None = Field(None, ge=-180, le=180)


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
    name: PersonName
    email: str = Email


class BroadcastIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field("", max_length=400)
    audience: Literal["all", "drivers", "riders", "new"] = Field(
        "all", description="everyone; members with a car saved; members without one; or members who haven't shared a ride yet")


class SuspendIn(BaseModel):
    user_id: int
    reason: str = Field("", max_length=200, description="Shown to the member")
    report_id: int | None = Field(None, description="The report this acts on; it is marked reviewed")


class PricingIn(BaseModel):
    suggested_per_km: float = Field(gt=0, le=100, description="Rs per km a rider travels, before the no-profit cap")
    car_cost_per_km: float = Field(gt=0, le=100, description="What a car costs to run per km (fuel and wear): the no-profit cap")
    min_contribution: int = Field(ge=0, le=1000, description="Rs per seat, unless that would break the cap on a short trip")


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
