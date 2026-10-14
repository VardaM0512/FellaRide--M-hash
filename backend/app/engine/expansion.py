"""Network Expansion Engine: grows a community from a small seed into a connected network.

    Analyse the network -> detect where it can grow -> predict demand -> pick the best actions
    -> trigger targeted onboarding -> measure what changed -> learn -> repeat

1. Demand-driven discovery: the community is split into ~1.5 km zones. Each zone gets its supply (drivers),
   demand (riders, seat requests), unmet demand (requests nobody filled), empty seats, lapsed riders, isolated
   members and its untapped potential (people on the organisation's roster who haven't joined). A simple trend
   (last 7 days against the 7 before) forecasts next week. Adjacent high-opportunity zones are merged into
   expansion areas (spatial clustering on the grid).
2. Cross-community graph: other communities' members who live in the same zone and travel in the same direction
   form shared corridors. A corridor neither community can fill alone but can together is a link worth opening.
3. Autonomous growth interventions: each area's bottleneck (too few drivers, empty seats, untapped neighbours,
   riders drifting away) maps to an action that nudges the right joined members through the normal nudge system.
   Actions are evaluated EVAL_DAYS later against the area's baseline, and each action type's success rate
   (a Beta posterior) steers the next choice, with a small exploration bonus for types tried less often.

Privacy: individual-level data is only used for people who joined this community (they consented by joining).
People who haven't joined (the organisation's roster) and other communities are only ever counted per zone, and
counts below K_MIN are suppressed.
"""
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Event, ExpansionAction, Intervention, Member, MemberState, RideOffer, RideRequest, Tenant
from . import scorer
from .context import CELL_DEG, Context, build_context, is_registered
from .geo import haversine_km
from .interventions import deliver, eligible, hhmm

K_MIN = 3                 # never report a count of non-members or another community's members below this
EVAL_DAYS = 2             # an action is judged this many days after it was taken
MAX_TARGETS = 5           # members nudged per action
LAPSED_DAYS = 7
NEAR_DEST_KM = 2.5

ACTIONS = {
    "recruit_drivers": {"label": "Recruit drivers", "gap": "drivers"},
    "activate_riders": {"label": "Fill empty seats", "gap": "riders"},
    "invite_neighbours": {"label": "Invite neighbours", "gap": "untapped"},
    "reactivate": {"label": "Win back riders", "gap": "retention"},
}
GAP_TEXT = {
    "drivers": "Riders here can't find seats",
    "riders": "Drivers here have empty seats",
    "untapped": "Most people here haven't joined",
    "retention": "Riders here have stopped riding",
    "isolated": "Members here haven't ridden with anyone yet",
}


def zone_of(lat: float, lon: float) -> tuple[int, int]:
    return int(lat // CELL_DEG), int(lon // CELL_DEG)


def zkey(z: tuple[int, int]) -> str:
    return f"{z[0]}:{z[1]}"


def kanon(n: int) -> int | None:
    """Counts of people we don't have individual consent for are only shown from K_MIN up."""
    return n if n >= K_MIN else None


@dataclass
class Zone:
    key: tuple[int, int]
    lat: float = 0.0
    lon: float = 0.0
    areas: Counter = field(default_factory=Counter)
    joined: list[Member] = field(default_factory=list)
    potential: int = 0            # roster people here who haven't joined (count only)
    drivers: int = 0
    riders: int = 0
    lapsed: int = 0
    isolated: int = 0
    demand_7: int = 0             # seat requests from here, last 7 days
    demand_prev: int = 0          # and the 7 before
    unmet_7: int = 0              # requests nobody filled
    unfilled_7: int = 0           # offers that left with nobody
    rides_7: int = 0              # completed shared rides people from here took part in

    @property
    def label(self) -> str:
        return self.areas.most_common(1)[0][0] if self.areas else "Unnamed area"

    @property
    def forecast(self) -> dict:
        growth = max(0.5, min(2.0, (self.demand_7 + 1) / (self.demand_prev + 1)))
        demand = self.demand_7 * growth
        unmet_share = self.unmet_7 / self.demand_7 if self.demand_7 else (1.0 if self.riders and not self.drivers else 0.0)
        return {"growth": round(growth, 2), "demand_next_7": round(demand, 1), "unmet_next_7": round(demand * unmet_share, 1)}

    @property
    def gaps(self) -> dict[str, float]:
        """How strongly each bottleneck applies here (0..1)."""
        g: dict[str, float] = {}
        joined = len(self.joined)
        if self.riders >= 2 and (self.drivers == 0 or self.unmet_7 >= 2):
            g["drivers"] = min(1.0, 0.4 + 0.15 * self.unmet_7 + (0.3 if self.drivers == 0 else 0))
        if self.unfilled_7 >= 2 and self.riders > 0:
            g["riders"] = min(1.0, 0.3 + 0.15 * self.unfilled_7)
        coverage = joined / (joined + self.potential) if joined + self.potential else 1.0
        if self.potential >= 6 and coverage < 0.45:
            g["untapped"] = min(1.0, (1 - coverage) * min(1.0, self.potential / 15))
        if self.lapsed >= 2:
            g["retention"] = min(1.0, 0.3 + 0.12 * self.lapsed)
        if self.isolated >= 3:
            g["isolated"] = min(1.0, 0.2 + 0.08 * self.isolated)
        return g

    @property
    def score(self) -> float:
        f = self.forecast
        return round(1.0 * f["unmet_next_7"] + 0.35 * self.potential + 0.6 * self.lapsed + 0.7 * self.unfilled_7
                     + 0.4 * self.isolated, 2)


def analyse(db: Session, ctx: Context) -> dict[tuple[int, int], Zone]:
    tenant, day = ctx.tenant, ctx.day
    zones: dict[tuple[int, int], Zone] = {}
    home: dict[int, tuple[int, int]] = {}
    for m in ctx.members.values():
        k = zone_of(m.home_lat, m.home_lon)
        z = zones.setdefault(k, Zone(key=k))
        z.areas[m.area or "Unnamed area"] += 1
        home[m.id] = k
        if not is_registered(m):
            z.potential += 1
            continue
        z.joined.append(m)
        z.lat += m.home_lat
        z.lon += m.home_lon
        if m.has_car:
            z.drivers += 1
        else:
            z.riders += 1
        if m.rides_count >= 1 and m.last_ride_day is not None and m.last_ride_day < day - LAPSED_DAYS:
            z.lapsed += 1
        if not ctx.partners.get(m.id) and not ctx.corridor(m.id).hot:
            z.isolated += 1
    for z in zones.values():
        n = len(z.joined)
        if n:
            z.lat, z.lon = z.lat / n, z.lon / n
        else:   # centre of the cell
            z.lat, z.lon = (z.key[0] + 0.5) * CELL_DEG, (z.key[1] + 0.5) * CELL_DEG

    for rider_id, d, status in db.execute(select(RideRequest.rider_id, RideRequest.day, RideRequest.status)
                                          .where(RideRequest.tenant_id == tenant.id, RideRequest.day >= day - 14)):
        z = zones.get(home.get(rider_id))
        if z is None:
            continue
        if d >= day - 6:
            z.demand_7 += 1
            z.unmet_7 += status in ("expired", "open")
        else:
            z.demand_prev += 1
    for driver_id, in db.execute(select(RideOffer.driver_id).where(RideOffer.tenant_id == tenant.id,
                                                                   RideOffer.day >= day - 6, RideOffer.status == "unfilled")):
        z = zones.get(home.get(driver_id))
        if z:
            z.unfilled_7 += 1
    for e in db.scalars(select(Event).where(Event.tenant_id == tenant.id, Event.type == "ride_completed", Event.day >= day - 6)):
        for mid in {e.member_id, *(e.payload or {}).get("riders", [])}:
            z = zones.get(home.get(mid))
            if z:
                z.rides_7 += 1
    return zones


def cluster(zones: dict[tuple[int, int], Zone], min_score: float = 2.0) -> list[list[Zone]]:
    """Merge neighbouring zones (8-neighbourhood) that both have room to grow into one expansion area."""
    hot = {k for k, z in zones.items() if z.score >= min_score and (z.joined or z.potential >= K_MIN)}
    seen, areas = set(), []
    for k in sorted(hot, key=lambda k: -zones[k].score):
        if k in seen:
            continue
        stack, group = [k], []
        seen.add(k)
        while stack:
            c = stack.pop()
            group.append(zones[c])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (c[0] + dx, c[1] + dy)
                    if n in hot and n not in seen:
                        seen.add(n)
                        stack.append(n)
        areas.append(group)
    areas.sort(key=lambda g: -sum(z.score for z in g))
    return areas


def area_out(group: list[Zone]) -> dict:
    labels = Counter()
    for z in group:
        labels.update(z.areas)
    joined = sum(len(z.joined) for z in group)
    potential = sum(z.potential for z in group)
    gaps: dict[str, float] = defaultdict(float)
    for z in group:
        for g, v in z.gaps.items():
            gaps[g] = max(gaps[g], v)
    fc = [z.forecast for z in group]
    total_w = sum(len(z.joined) or 1 for z in group)
    return {
        "id": zkey(group[0].key),
        "label": labels.most_common(1)[0][0],
        "zones": [zkey(z.key) for z in group],
        "lat": round(sum(z.lat * (len(z.joined) or 1) for z in group) / total_w, 5),
        "lon": round(sum(z.lon * (len(z.joined) or 1) for z in group) / total_w, 5),
        "score": round(sum(z.score for z in group), 1),
        "joined": joined,
        "drivers": sum(z.drivers for z in group),
        "riders": sum(z.riders for z in group),
        "potential": kanon(potential),
        "coverage": round(joined / (joined + potential), 2) if joined + potential else None,
        "demand_7": sum(z.demand_7 for z in group),
        "unmet_7": sum(z.unmet_7 for z in group),
        "unfilled_7": sum(z.unfilled_7 for z in group),
        "lapsed": sum(z.lapsed for z in group),
        "rides_7": sum(z.rides_7 for z in group),
        "forecast": {"demand_next_7": round(sum(f["demand_next_7"] for f in fc), 1),
                     "unmet_next_7": round(sum(f["unmet_next_7"] for f in fc), 1),
                     "trend": "rising" if sum(z.demand_7 for z in group) > sum(z.demand_prev for z in group)
                     else "falling" if sum(z.demand_7 for z in group) < sum(z.demand_prev for z in group) else "steady"},
        "gaps": [{"code": g, "text": GAP_TEXT[g], "severity": round(v, 2)} for g, v in sorted(gaps.items(), key=lambda kv: -kv[1])],
    }


# ---------- community-level diagnosis: why isn't it growing? ----------
def diagnose(ctx: Context, zones: dict[tuple[int, int], Zone], areas: list[dict]) -> list[dict]:
    joined = [m for m in ctx.members.values() if is_registered(m)]
    total = len(ctx.members)
    findings = []
    if not joined:
        return [{"code": "empty", "title": "No members yet", "detail": "Share the join code to seed the community.", "severity": 1.0}]
    drivers = sum(1 for m in joined if m.has_car)
    share = drivers / len(joined)
    if share < 0.25:
        findings.append({"code": "drivers", "title": "Too few drivers",
                         "detail": f"Only {drivers} of {len(joined)} members drive ({round(share * 100)}%). Riders outnumber seats.",
                         "severity": round(min(1.0, (0.25 - share) * 4 + 0.3), 2)})
    unfilled = sum(z.unfilled_7 for z in zones.values())
    if unfilled >= 3:
        findings.append({"code": "riders", "title": "Low passenger density",
                         "detail": f"{unfilled} rides left with empty cars this week.", "severity": round(min(1.0, 0.2 + unfilled * 0.06), 2)})
    riders_ever = [m for m in joined if m.rides_count >= 1]
    repeat = sum(1 for m in riders_ever if m.rides_count >= 2) / len(riders_ever) if riders_ever else 0.0
    lapsed = sum(z.lapsed for z in zones.values())
    lapsed_share = lapsed / len(riders_ever) if riders_ever else 0.0
    if riders_ever and repeat < 0.4:
        findings.append({"code": "retention", "title": "Riders don't come back",
                         "detail": f"Only {round(repeat * 100)}% of riders rode a second time.",
                         "severity": round(min(1.0, (0.4 - repeat) * 2 + 0.3), 2)})
    elif riders_ever and lapsed >= 3 and lapsed_share >= 0.08:
        findings.append({"code": "retention", "title": "Some riders are drifting away",
                         "detail": f"{lapsed} riders haven't ridden for over a week, though {round(repeat * 100)}% of riders come back.",
                         "severity": round(min(1.0, lapsed_share * 2), 2)})
    isolated = sum(z.isolated for z in zones.values())
    if isolated / len(joined) > 0.4:
        findings.append({"code": "isolated", "title": "Isolated clusters",
                         "detail": f"{isolated} members live where no ride group has formed yet.",
                         "severity": round(min(1.0, isolated / len(joined)), 2)})
    coverage = len(joined) / total if total else 1.0
    untapped = [a for a in areas if any(g["code"] == "untapped" for g in a["gaps"])]
    if coverage < 0.6 and untapped:
        findings.append({"code": "untapped", "title": "Untapped neighbourhoods",
                         "detail": f"{round(coverage * 100)}% of the roster has joined. {', '.join(a['label'] for a in untapped[:3])} have the most room.",
                         "severity": round(min(1.0, 1 - coverage), 2)})
    findings.sort(key=lambda f: -f["severity"])
    return findings


# ---------- cross-community graph ----------
SECTORS = 8


HEADING = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"]


def _direction(m: Member, dests: dict) -> int:
    """Compass sector of the trip from home to destination: 0 = east, counter-clockwise in 45 degree steps."""
    d = dests[m.destination_id]
    ang = math.atan2(d.lat - m.home_lat, (d.lon - m.home_lon) * math.cos(math.radians(m.home_lat)))
    return round(ang / (2 * math.pi / SECTORS)) % SECTORS


def cross_community(db: Session, tenant: Tenant, ctx: Context) -> list[dict]:
    """Shared corridors with other communities: same home zone, same direction of travel."""
    mine = [m for m in ctx.members.values() if is_registered(m)]
    out = []
    for other in db.scalars(select(Tenant).where(Tenant.id != tenant.id)):
        theirs = list(db.scalars(select(Member).where(Member.tenant_id == other.id, Member.state != MemberState.DISCOVERED)))
        if not theirs:
            continue
        octx_dests = {d.id: d for d in other.destinations}
        groups: dict[tuple, dict] = defaultdict(lambda: {"mine": [0, 0], "theirs": [0, 0], "label": Counter()})
        for m in mine:
            g = groups[(zone_of(m.home_lat, m.home_lon), _direction(m, ctx.destinations))]
            g["mine"][0 if m.has_car else 1] += 1
            g["label"][m.area] += 1
        for m in theirs:
            # someone from the other community shares a corridor if they live in the same or a neighbouring zone
            # and head the same way (within one compass sector): a driver could pick them up on the way
            (zx, zy), d = zone_of(m.home_lat, m.home_lon), _direction(m, octx_dests)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for ds in (-1, 0, 1):
                        k = ((zx + dx, zy + dy), (d + ds) % SECTORS)
                        if k in groups:   # only where this community already has people
                            groups[k]["theirs"][0 if m.has_car else 1] += 1
        corridors = []
        for (z, sector), g in groups.items():
            td, tr = g["theirs"]
            if td + tr < K_MIN:
                continue
            md, mr = g["mine"]
            alone = md >= 1 and mr >= 1 and md + mr >= 3
            together = (md + td) >= 1 and (mr + tr) >= 1 and md + mr + td + tr >= 3
            corridors.append({"id": f"{zkey(z)}:{sector}", "zone": zkey(z), "area": g["label"].most_common(1)[0][0],
                              "heading": HEADING[sector], "members_here": md + mr,
                              "members_there": td + tr, "drivers_together": md + td, "riders_together": mr + tr,
                              "viable_together": together and not alone})
        corridors.sort(key=lambda c: (not c["viable_together"], -(c["members_here"] + c["members_there"])))
        near = 0
        for m in mine:
            d = ctx.destinations[m.destination_id]
            if any(haversine_km(d.lat, d.lon, od.lat, od.lon) <= NEAR_DEST_KM for od in other.destinations):
                near += 1
        unlocked = sum(c["viable_together"] for c in corridors)
        if not corridors and not near:
            continue
        rec = (f"Open {unlocked} shared corridor{'s' if unlocked != 1 else ''} with {other.name}: neither community can fill them alone."
               if unlocked else f"{near} of your members travel near {other.name}. Link the communities so they can ride together."
               if near >= K_MIN else f"Watch {other.name}: your members overlap on {len(corridors)} corridor{'s' if len(corridors) != 1 else ''}.")
        out.append({"community_id": other.id, "community": other.name, "synthetic": other.is_synthetic,
                    "shared_corridors": corridors[:6], "corridors_unlocked": unlocked, "members_near_destinations": kanon(near) or 0,
                    "strength": unlocked * 3 + len(corridors) + near / 5, "recommendation": rec})
    out.sort(key=lambda x: -x["strength"])
    return out[:4]


# ---------- learning: which actions work ----------
def effectiveness(db: Session, tenant: Tenant) -> dict[str, dict]:
    stats = {k: {"label": v["label"], "trials": 0, "successes": 0} for k, v in ACTIONS.items()}
    for a in db.scalars(select(ExpansionAction).where(ExpansionAction.tenant_id == tenant.id, ExpansionAction.status == "evaluated")):
        if a.kind in stats:
            stats[a.kind]["trials"] += 1
            stats[a.kind]["successes"] += bool(a.outcome.get("success"))
    for s in stats.values():
        s["rate"] = round((s["successes"] + 1) / (s["trials"] + 2), 3)   # Beta(1,1) posterior mean
    return stats


def _area_numbers(zones: dict[tuple[int, int], Zone], keys: list[str]) -> dict:
    zs = [z for z in zones.values() if zkey(z.key) in keys]
    return {"joined": sum(len(z.joined) for z in zs), "rides_7": sum(z.rides_7 for z in zs),
            "unmet_7": sum(z.unmet_7 for z in zs), "potential": sum(z.potential for z in zs)}


def evaluate(db: Session, tenant: Tenant, zones: dict[tuple[int, int], Zone]) -> int:
    """Judge actions old enough: did the nudged members respond, and did the area grow?"""
    done = 0
    for a in db.scalars(select(ExpansionAction).where(ExpansionAction.tenant_id == tenant.id, ExpansionAction.status == "active",
                                                      ExpansionAction.day <= tenant.current_day - EVAL_DAYS)):
        statuses = Counter(db.scalars(select(Intervention.status).where(Intervention.id.in_(a.intervention_ids or [-1]))))
        now = _area_numbers(zones, a.zones)
        b = a.baseline or {}
        joined_delta = now["joined"] - b.get("joined", 0)
        rides_delta = now["rides_7"] - b.get("rides_7", 0)
        sent = sum(statuses.values())
        responded = statuses.get("responded", 0)
        success = responded >= 1 and (joined_delta > 0 or rides_delta > 0 or responded / max(sent, 1) >= 0.5)
        a.outcome = {"sent": sent, "responded": responded, "joined_delta": joined_delta, "rides_delta": rides_delta,
                     "evaluated_day": tenant.current_day, "success": success}
        a.status = "evaluated"
        done += 1
    db.flush()
    return done


# ---------- acting ----------
def _targets(ctx: Context, kind: str, members: list[Member], weights) -> list[tuple[Member, str, int | None]]:
    day = ctx.day
    pool = [m for m in members if eligible(m, day)]
    drivers_here = [m for m in members if m.has_car]
    out = []
    if kind == "recruit_drivers":
        cand = sorted((m for m in pool if m.has_car), key=lambda m: -scorer.score_member(weights, ctx.features(m))["driver"])
        for m in cand:
            riders = sum(1 for r in members if not r.has_car and r.destination_id == m.destination_id)
            dest = ctx.destinations[m.destination_id].name
            out.append((m, f"{max(riders, 2)} people near {m.area or 'you'} want a seat to {dest} around {hhmm(m.depart_min)}. Offer a ride this week?", None))
    elif kind in ("activate_riders", "reactivate"):
        cand = [m for m in pool if not m.has_car and (kind == "activate_riders" or m.rides_count >= 1)]
        cand.sort(key=lambda m: -scorer.score_member(weights, ctx.features(m))["rider"])
        for m in cand:
            d = min(drivers_here, key=lambda d: abs(d.depart_min - m.depart_min), default=None)
            dest = ctx.destinations[m.destination_id].name
            msg = (f"{d.name} drives from {m.area or 'your area'} with free seats around {hhmm(d.depart_min)}. Share the ride?" if d
                   else f"Rides from {m.area or 'your area'} to {dest} are running this week. Join one?")
            if kind == "reactivate":
                msg = f"We miss you on the {dest} route. " + msg
            out.append((m, msg, d.id if d else None))
    elif kind == "invite_neighbours":
        cand = [m for m in pool if any(ctx.members[t].state == MemberState.DISCOVERED for t in ctx.ties.get(m.id, ()))]
        cand.sort(key=lambda m: (-m.is_connector, -len(ctx.ties.get(m.id, ()))))
        for m in cand:
            k = sum(1 for t in ctx.ties.get(m.id, ()) if ctx.members[t].state == MemberState.DISCOVERED)
            out.append((m, f"{k} people you know around {m.area or 'you'} haven't joined yet. Invite the ones who commute like you?", None))
    return out[:MAX_TARGETS]


NUDGE_KIND = {"recruit_drivers": "driver", "activate_riders": "rider", "reactivate": "rider", "invite_neighbours": "connector"}


def plan(db: Session, tenant: Tenant, ctx: Context, zones: dict[tuple[int, int], Zone], groups: list[list[Zone]],
         max_actions: int = 3) -> list[dict]:
    """Rank (area, action) pairs by opportunity x how well that action has worked x an exploration bonus."""
    stats = effectiveness(db, tenant)
    total = sum(s["trials"] for s in stats.values()) + 1
    taken_today = {(a.area, a.kind) for a in db.scalars(select(ExpansionAction).where(
        ExpansionAction.tenant_id == tenant.id, ExpansionAction.day == ctx.day))}
    top = max((sum(z.score for z in g) for g in groups), default=1.0) or 1.0
    options = []
    for g in groups[:8]:
        info = area_out(g)
        opp = info["score"] / top
        for gap in info["gaps"]:
            kind = next((k for k, v in ACTIONS.items() if v["gap"] == gap["code"]), None)
            if kind is None or (info["label"], kind) in taken_today:
                continue
            s = stats[kind]
            explore = 0.25 * math.sqrt(math.log(total + 1) / (s["trials"] + 1))
            value = opp * gap["severity"] * (s["rate"] + explore)
            options.append({"kind": kind, "area": info, "gap": gap, "value": round(value, 3),
                            "why": f"{GAP_TEXT[gap['code']]} in {info['label']}"})
    options.sort(key=lambda o: -o["value"])
    chosen, used_areas = [], set()
    for o in options:
        if len(chosen) >= max_actions:
            break
        if o["area"]["id"] in used_areas:
            continue
        chosen.append(o)
        used_areas.add(o["area"]["id"])
    return chosen


def act(db: Session, tenant: Tenant, ctx: Context, zones: dict[tuple[int, int], Zone], option: dict) -> ExpansionAction | None:
    area = option["area"]
    members = [m for z in zones.values() if zkey(z.key) in area["zones"] for m in z.joined]
    weights = scorer.tenant_weights(db, tenant)
    targets = _targets(ctx, option["kind"], members, weights)
    if not targets:
        return None
    ivs = [deliver(db, ctx, tenant, m, NUDGE_KIND[option["kind"]], msg, suggested, option["value"], "expansion")
           for m, msg, suggested in targets]
    db.flush()
    a = ExpansionAction(tenant_id=tenant.id, day=ctx.day, kind=option["kind"], area=area["label"], zones=area["zones"],
                        reason=option["why"], message=targets[0][1], target_ids=[m.id for m, _, _ in targets],
                        intervention_ids=[iv.id for iv in ivs], expected=option["value"],
                        baseline=_area_numbers(zones, area["zones"]), status="active")
    db.add(a)
    db.add(Event(tenant_id=tenant.id, day=ctx.day, type="expansion_action", payload={"kind": a.kind, "area": a.area}))
    db.flush()
    return a


def run_cycle(db: Session, tenant: Tenant, max_actions: int = 3) -> dict:
    """One full loop: evaluate past actions, analyse, choose and take new actions."""
    ctx = build_context(db, tenant)
    zones = analyse(db, ctx)
    evaluated = evaluate(db, tenant, zones)
    groups = cluster(zones)
    taken = [a for o in plan(db, tenant, ctx, zones, groups, max_actions) if (a := act(db, tenant, ctx, zones, o))]
    return {"day": tenant.current_day, "evaluated": evaluated, "actions": [action_out(a) for a in taken]}


def report(db: Session, tenant: Tenant) -> dict:
    ctx = build_context(db, tenant)
    zones = analyse(db, ctx)
    evaluate(db, tenant, zones)
    groups = cluster(zones)
    areas = [area_out(g) for g in groups]
    preview = plan(db, tenant, ctx, zones, groups)
    actions = list(db.scalars(select(ExpansionAction).where(ExpansionAction.tenant_id == tenant.id)
                              .order_by(ExpansionAction.id.desc()).limit(30)))
    joined = sum(1 for m in ctx.members.values() if is_registered(m))
    return {
        "day": tenant.current_day,
        "network": {"members_joined": joined, "roster_not_joined": kanon(len(ctx.members) - joined),
                    "zones_active": sum(1 for z in zones.values() if z.joined), "expansion_areas": len(areas)},
        "diagnosis": diagnose(ctx, zones, areas),
        "areas": areas[:8],
        "next_actions": [{"kind": o["kind"], "label": ACTIONS[o["kind"]]["label"], "area": o["area"]["label"],
                          "why": o["why"], "value": o["value"]} for o in preview],
        "cross_community": cross_community(db, tenant, ctx),
        "actions": [action_out(a) for a in actions],
        "effectiveness": effectiveness(db, tenant),
        "privacy": f"Individual data is used only for people who joined this community. People who haven't joined and "
                   f"other communities are only counted per area, and counts under {K_MIN} are hidden.",
    }


def action_out(a: ExpansionAction) -> dict:
    return {"id": a.id, "day": a.day, "kind": a.kind, "label": ACTIONS.get(a.kind, {}).get("label", "Shared corridor"),
            "area": a.area, "reason": a.reason, "message": a.message, "targeted": len(a.target_ids or []),
            "status": a.status, "baseline": a.baseline, "outcome": a.outcome, "expected": a.expected}


def propose_corridor(db: Session, tenant: Tenant, other: Tenant, corridor: dict) -> ExpansionAction:
    """The organiser proposes opening a shared corridor with another community (recorded for both organisers)."""
    a = ExpansionAction(tenant_id=tenant.id, day=tenant.current_day, kind="shared_corridor", area=corridor["area"],
                        zones=[corridor["zone"]], reason=f"Shared corridor with {other.name}",
                        message=f"{corridor['members_here']} here + {corridor['members_there']} from {other.name}",
                        status="proposed")
    db.add(a)
    db.add(Event(tenant_id=tenant.id, day=tenant.current_day, type="corridor_proposed",
                 payload={"with": other.id, "zone": corridor["zone"]}))
    db.flush()
    return a
