"""Request bodies. Every field is bounded so bad input is rejected with a clear 422."""
from typing import Literal

from pydantic import BaseModel, Field

Lat = Field(ge=-90, le=90)
Lon = Field(ge=-180, le=180)
Minutes = Field(ge=0, le=1439, description="Minutes after midnight, e.g. 480 = 08:00")


class DestinationIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lat: float = Lat
    lon: float = Lon


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["university", "corporate", "residential", "alumni", "professional"] = "university"
    center_lat: float = Lat
    center_lon: float = Lon
    destinations: list[DestinationIn] = Field(min_length=1, max_length=20)


class DemoCreate(BaseModel):
    seed_active: int = Field(15, ge=5, le=40, description="Members active on day 0")
    seed: int = Field(7, ge=0, le=10_000)


class MemberImport(BaseModel):
    name: str = Field(min_length=1, max_length=120)
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
    member_id: int
    depart_min: int | None = Field(None, ge=0, le=1439)
    seats: int | None = Field(None, ge=1, le=8)


class RequestIn(BaseModel):
    member_id: int
    depart_min: int | None = Field(None, ge=0, le=1439)


class FinishIn(BaseModel):
    completed: bool


class PlanIn(BaseModel):
    budget: int | None = Field(None, ge=1, le=200)
    strategy: Literal["smart", "random"] = "smart"
    connectors_first: bool = True


class RespondIn(BaseModel):
    responded: bool


class ReferralIn(BaseModel):
    inviter_id: int
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
