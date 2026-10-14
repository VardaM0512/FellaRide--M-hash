"""Community Intelligence: one in-memory snapshot of a tenant that every engine step reads.

Building it once per request keeps the engine fast and makes every decision in a call
use the same view of the community.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Connection, Destination, Member, MemberState, Tenant

FEATURES = ["has_car", "corridor_density", "recent_rides", "social_degree", "past_response", "bias"]
CELL_DEG = 0.0135          # ~1.5 km grid cell for corridor grouping
WINDOW_MIN = 30            # departure window size
DAY_START_MIN = 420        # 07:00 anchor for windows


@dataclass
class Corridor:
    """Members sharing home area + destination + 30-min departure window."""

    key: str
    destination_id: int
    window_start_min: int
    member_ids: list[int] = field(default_factory=list)
    registered: int = 0
    drivers: int = 0
    riders: int = 0
    lat: float = 0.0
    lon: float = 0.0
    area: str = ""

    @property
    def hot(self) -> bool:
        return self.registered >= 3 and self.drivers >= 1 and self.riders >= 1

    @property
    def value(self) -> float:
        """How much activating someone here is worth to the network."""
        return 1.3 if self.hot else 0.6 + 0.1 * self.registered


def corridor_key(m: Member) -> str:
    window = (m.depart_min - DAY_START_MIN) // WINDOW_MIN
    return f"{int(m.home_lat // CELL_DEG)}:{int(m.home_lon // CELL_DEG)}:{m.destination_id}:{window}"


def is_registered(m: Member) -> bool:
    return m.state != MemberState.DISCOVERED


@dataclass
class Context:
    tenant: Tenant
    day: int
    members: dict[int, Member]
    destinations: dict[int, Destination]
    ties: dict[int, set[int]]           # social ties
    partners: dict[int, set[int]]       # co-ride partners
    corridors: dict[str, Corridor]
    corridor_of: dict[int, str]

    def corridor(self, member_id: int) -> Corridor:
        return self.corridors[self.corridor_of[member_id]]

    def dest_point(self, m: Member) -> tuple[float, float]:
        d = self.destinations[m.destination_id]
        return d.lat, d.lon

    def features(self, m: Member) -> list[float]:
        """Feature vector used by every propensity model (same order as FEATURES)."""
        c = self.corridor(m.id)
        recent = 0.0
        if m.last_ride_day is not None and m.last_ride_day >= self.day - 7:
            recent = min(1.0, m.rides_count / 4)
        past = m.nudges_responded / m.nudges_received if m.nudges_received else 0.5
        return [
            1.0 if m.has_car else 0.0,
            min(1.0, c.registered / 6),
            recent,
            min(1.0, len(self.ties.get(m.id, ())) / 12),
            past,
            1.0,
        ]


def build_context(db: Session, tenant: Tenant) -> Context:
    members = {m.id: m for m in db.scalars(select(Member).where(Member.tenant_id == tenant.id))}
    destinations = {d.id: d for d in db.scalars(select(Destination).where(Destination.tenant_id == tenant.id))}
    ties: dict[int, set[int]] = defaultdict(set)
    partners: dict[int, set[int]] = defaultdict(set)
    for c in db.scalars(select(Connection).where(Connection.tenant_id == tenant.id)):
        target = ties if c.kind == "social" else partners
        target[c.a_id].add(c.b_id)
        target[c.b_id].add(c.a_id)

    corridors: dict[str, Corridor] = {}
    corridor_of: dict[int, str] = {}
    areas: dict[str, Counter] = defaultdict(Counter)
    for m in members.values():
        k = corridor_key(m)
        c = corridors.get(k)
        if c is None:
            window = (m.depart_min - DAY_START_MIN) // WINDOW_MIN
            c = corridors[k] = Corridor(key=k, destination_id=m.destination_id,
                                        window_start_min=DAY_START_MIN + window * WINDOW_MIN)
        c.member_ids.append(m.id)
        c.lat += m.home_lat
        c.lon += m.home_lon
        areas[k][m.area] += 1
        if is_registered(m):
            c.registered += 1
            if m.has_car:
                c.drivers += 1
            else:
                c.riders += 1
        corridor_of[m.id] = k
    for k, c in corridors.items():
        c.lat /= len(c.member_ids)
        c.lon /= len(c.member_ids)
        c.area = areas[k].most_common(1)[0][0]

    return Context(tenant=tenant, day=tenant.current_day, members=members, destinations=destinations,
                   ties=ties, partners=partners, corridors=corridors, corridor_of=corridor_of)
