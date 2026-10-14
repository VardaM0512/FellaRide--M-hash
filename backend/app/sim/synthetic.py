"""SYNTHETIC tenant generator (clearly labelled synthetic data, per hackathon rule 3).

Builds a university community that mirrors the FellaRide Growth Simulator: 6 neighbourhoods plus
scattered members, 3 destinations, social ties, connectors, and a small active seed group.
No real people: names are generic first names with an initial, emails are @example.edu.
"""
import math
import random

from sqlalchemy.orm import Session

from ..engine import daycycle
from ..engine.geo import haversine_km, offset
from ..models import Connection, Destination, Member, MemberState, SyntheticTrait, Tenant

CENTER = (12.9716, 77.5946)   # synthetic city centre (coordinates only, no real community data)

# Positions in km from the main campus (east, north), matching the simulator layout.
DESTINATIONS = [("Main Campus", 0.0, 0.0), ("Medical Block", 4.2, -2.8), ("Tech Park", 4.3, 3.5)]
HOODS = [
    # name, east_km, north_km, radius_km, members, destination weights, typical departure (min)
    ("North Hills", -6.7, 3.7, 1.0, 34, (.82, .06, .12), 470),
    ("Lakeview", -7.5, 0.0, 1.0, 30, (.85, .10, .05), 480),
    ("Old Town", -5.5, -3.2, 1.0, 32, (.75, .20, .05), 465),
    ("Station Road", -2.2, 3.5, 0.8, 24, (.65, .05, .30), 495),
    ("Riverside", -0.7, -3.5, 0.8, 26, (.65, .30, .05), 475),
    ("Green Park", -3.3, 0.0, 0.7, 20, (.90, .05, .05), 490),
]
SCATTERED = 14
FIRST = ["Aarav", "Diya", "Ishaan", "Ananya", "Kabir", "Meera", "Rohan", "Saanvi", "Vihaan", "Aditi", "Arjun",
         "Kavya", "Nikhil", "Riya", "Siddharth", "Tara", "Yash", "Zoya", "Dev", "Neha", "Pranav", "Isha", "Rahul",
         "Sneha", "Varun", "Pooja", "Aman", "Nisha", "Karan", "Shreya", "Harsh", "Divya", "Om", "Leela", "Manav",
         "Asha", "Rhea", "Farhan", "Gauri", "Jay"]
LAST = "ABCDEGHJKLMNPRSTV"


def create_synthetic_tenant(db: Session, name: str = "Synthetic University (demo)", seed_active: int = 15,
                            seed: int = 7, center: tuple[float, float] = CENTER, kind: str = "university") -> Tenant:
    rng = random.Random(seed)
    tenant = Tenant(name=name, kind=kind, center_lat=center[0], center_lon=center[1], is_synthetic=True)
    db.add(tenant)
    db.flush()
    dests = []
    for dname, e, n in DESTINATIONS:
        lat, lon = offset(*center, e, n)
        d = Destination(tenant_id=tenant.id, name=dname, lat=lat, lon=lon)
        db.add(d)
        dests.append(d)
    db.flush()

    rows: list[tuple[Member, SyntheticTrait]] = []
    counter = 0

    def add(area: str, east: float, north: float, weights, base_t: int):
        nonlocal counter
        counter += 1
        u = rng.random()
        di = 0 if u < weights[0] else 1 if u < weights[0] + weights[1] else 2
        has_car = rng.random() < 0.32
        seats = (3 if rng.random() < 0.6 else 2) if has_car else 0
        lat, lon = offset(*center, east, north)
        depart = int(round(base_t + rng.gauss(0, 14) + (20 if di == 2 else 0)))
        nm = f"{FIRST[counter % len(FIRST)]} {rng.choice(LAST)}."
        m = Member(tenant_id=tenant.id, name=nm, email=f"member{counter}@example.edu", area=area, home_lat=lat,
                   home_lon=lon, destination_id=dests[di].id, depart_min=max(360, min(660, depart)),
                   has_car=has_car, seats=seats, role_pref="both" if has_car else "passenger",
                   ride_pref="quiet" if rng.random() < .5 else "music", is_synthetic=True)
        trait = SyntheticTrait(t_drive=rng.uniform(.15, .9) if has_car else 0.0, t_ride=rng.uniform(.2, .95),
                               t_refer=rng.uniform(.05, .7), responsiveness=rng.uniform(.35, 1.0))
        rows.append((m, trait))

    for area, e, n, r, count, weights, t in HOODS:
        for _ in range(count):
            ang, dist = rng.uniform(0, 6.283), (rng.random() ** 0.5) * r
            add(area, e + math.cos(ang) * dist, n + math.sin(ang) * dist * 0.85, weights, t)
    for _ in range(SCATTERED):
        add("Scattered", rng.uniform(-9, 5.6), rng.uniform(-4.2, 4.6), (.6, .2, .2), 480)

    for m, _ in rows:
        db.add(m)
    db.flush()
    for m, tr in rows:
        tr.member_id = m.id
        db.add(tr)

    # social ties: neighbours within ~1.2 km, plus extra ties for a few hubs
    members = [m for m, _ in rows]
    pairs = set()
    for i, a in enumerate(members):
        for b in members[i + 1:]:
            if haversine_km(a.home_lat, a.home_lon, b.home_lat, b.home_lon) < 1.17 and rng.random() < 0.22:
                pairs.add((a.id, b.id))
    degree = {m.id: 0 for m in members}
    for a, b in pairs:
        degree[a] += 1
        degree[b] += 1
    hubs = sorted(members, key=lambda m: degree[m.id], reverse=True)[:4]
    traits = {m.id: tr for m, tr in rows}
    for h in hubs:
        traits[h.id].t_refer = max(traits[h.id].t_refer, .75)
        traits[h.id].responsiveness = max(traits[h.id].responsiveness, .8)
        for _ in range(10):
            o = rng.choice(members)
            if o.id != h.id:
                pairs.add((min(h.id, o.id), max(h.id, o.id)))
    for a, b in pairs:
        db.add(Connection(tenant_id=tenant.id, a_id=a, b_id=b, kind="social"))
    db.flush()
    daycycle.refresh_connectors(db, tenant)

    # day-0 seed: a few members already interacting, more signed up but idle
    shuffled = members[:]
    rng.shuffle(shuffled)
    for i, m in enumerate(shuffled[:seed_active]):
        m.registered_day = 0
        m.state = MemberState.REGISTERED
        if i % 3 == 0:
            m.interacted_day = 0
            m.state = MemberState.INTERACTED
    idle = [m for m in shuffled[seed_active:]][: round(seed_active * 1.6)]
    for m in idle:
        m.registered_day = 0
        m.state = MemberState.REGISTERED
    db.flush()
    return tenant


NEIGHBOUR_NAME = "Synthetic Tech Park (demo)"


def create_neighbour_tenant(db: Session, of: Tenant) -> Tenant:
    """A second SYNTHETIC community a few km away whose neighbourhoods partly overlap the first one, so the
    expansion engine has another community to find shared corridors with."""
    lat, lon = offset(of.center_lat, of.center_lon, 3.2, 2.4)
    return create_synthetic_tenant(db, name=NEIGHBOUR_NAME, seed=23, center=(lat, lon), kind="corporate", seed_active=12)
