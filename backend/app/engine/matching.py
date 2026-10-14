"""Matching Engine.

score = 0.40 * route overlap + 0.25 * (1 - detour / max_detour) + 0.25 * (1 - |dt| / max_dt) + 0.10 * preference fit
A pair is only eligible with the same destination, |dt| <= max_dt, detour <= max_detour and a free seat.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Booking, Event, Member, RideOffer, RideRequest, Tenant
from .context import Context, is_registered
from .geo import detour_km, direction_overlap


@dataclass
class MatchResult:
    score: float
    overlap: float
    detour_km: float
    time_gap_min: int
    pref_fit: float

    def as_dict(self) -> dict:
        return {"score": round(self.score, 3), "route_overlap": round(self.overlap, 3),
                "detour_km": round(self.detour_km, 2), "time_gap_min": self.time_gap_min,
                "preference_fit": self.pref_fit}


def pref_fit(a: Member, b: Member) -> float:
    if "any" in (a.ride_pref, b.ride_pref) or a.ride_pref == b.ride_pref:
        return 1.0
    return 0.5


def match_score(ctx: Context, driver: Member, rider: Member,
                driver_depart: int | None = None, rider_depart: int | None = None) -> MatchResult | None:
    s = get_settings()
    if driver.id == rider.id or driver.destination_id != rider.destination_id:
        return None
    dt = abs((driver_depart if driver_depart is not None else driver.depart_min)
             - (rider_depart if rider_depart is not None else rider.depart_min))
    if dt > s.max_time_gap_min:
        return None
    dest = ctx.dest_point(driver)
    d_home, r_home = (driver.home_lat, driver.home_lon), (rider.home_lat, rider.home_lon)
    detour = detour_km(d_home, r_home, dest)
    if detour > s.max_detour_km:
        return None
    overlap = direction_overlap(d_home, r_home, dest)
    pf = pref_fit(driver, rider)
    score = 0.40 * overlap + 0.25 * (1 - detour / s.max_detour_km) + 0.25 * (1 - dt / s.max_time_gap_min) + 0.10 * pf
    return MatchResult(score, overlap, detour, dt, pf)


def recommend_partners(ctx: Context, member: Member, limit: int = 5) -> list[tuple[Member, MatchResult]]:
    """Ranked partners for a member without them having to search.
    Drivers get compatible riders; passengers get compatible drivers."""
    out = []
    for other in ctx.members.values():
        if other.id == member.id or not is_registered(other):
            continue
        if member.has_car and not other.has_car:
            r = match_score(ctx, member, other)
        elif not member.has_car and other.has_car:
            r = match_score(ctx, other, member)
        else:
            continue
        if r:
            out.append((other, r))
    out.sort(key=lambda t: t[1].score, reverse=True)
    return out[:limit]


def run_matching(db: Session, ctx: Context, tenant: Tenant, day: int) -> list[Booking]:
    """Greedy global matching for one day: best-scoring pairs are seated first."""
    offers = list(db.scalars(select(RideOffer).where(RideOffer.tenant_id == tenant.id, RideOffer.day == day,
                                                     RideOffer.status == "open", RideOffer.seats_left > 0)))
    requests = list(db.scalars(select(RideRequest).where(RideRequest.tenant_id == tenant.id,
                                                         RideRequest.day == day, RideRequest.status == "open")))
    pairs = []
    for o in offers:
        driver = ctx.members[o.driver_id]
        for q in requests:
            if q.destination_id != o.destination_id:
                continue
            r = match_score(ctx, driver, ctx.members[q.rider_id], o.depart_min, q.depart_min)
            if r:
                pairs.append((r.score, o, q))
    pairs.sort(key=lambda t: t[0], reverse=True)
    bookings = []
    for score, o, q in pairs:
        if q.status != "open" or o.seats_left <= 0:
            continue
        b = Booking(tenant_id=tenant.id, offer_id=o.id, request_id=q.id, driver_id=o.driver_id,
                    rider_id=q.rider_id, day=day, score=round(score, 4))
        db.add(b)
        q.status = "matched"
        o.seats_left -= 1
        if o.seats_left == 0:
            o.status = "full"
        bookings.append(b)
        db.add(Event(tenant_id=tenant.id, member_id=q.rider_id, day=day, type="ride_matched",
                     payload={"offer_id": o.id, "driver_id": o.driver_id, "score": round(score, 3)}))
    db.flush()
    return bookings
