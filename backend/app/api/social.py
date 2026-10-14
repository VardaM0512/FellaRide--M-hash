"""Community: a shared board (posts, reactions, replies), live activity from real rides, a weekly community
challenge, leaderboards and each member's own impact and badges.

Ride numbers come from the engine's `ride_completed` events, so rides finished in the member app and rides in
the synthetic demo count the same way. Distances for engine rides are estimated from home to destination;
app rides use the route the driver confirmed. CO2 is an estimate (a car trip avoided per rider).
"""
import math
import random
from dataclasses import dataclass
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import Actor, current_actor
from ..db import get_db
from ..engine import trips as T
from ..engine.geo import haversine_km
from ..models import (CommunityPost, Connection, Event, Member, MemberState, PostComment, PostReaction, Profile,
                      Referral, Tenant, Trip, User)
from ..schemas import CommentIn, PostIn, ReactionIn

router = APIRouter(prefix="/community", tags=["community"])

CO2_KG_PER_KM = 0.12          # an average petrol car, per km not driven
EMOJIS = ("thumbs", "heart", "party", "thanks")
FEED_LIMIT = 40


# ---------- who is asking ----------
def _name(db: Session, actor: Actor) -> str:
    if actor.is_admin:
        return "Organiser"
    p = db.get(Profile, actor.user.id)
    if not p:
        raise HTTPException(409, "Add your name, gender and mobile number first.")
    return p.name


def _tenant(db: Session, actor: Actor) -> Tenant:
    return db.get(Tenant, actor.tenant_id)


# ---------- rides, from the engine's events ----------
@dataclass
class Ride:
    day: int
    driver: int
    riders: list[int]
    km: float


def _rides(db: Session, tenant: Tenant, since_day: int | None = None) -> list[Ride]:
    q = select(Event).where(Event.tenant_id == tenant.id, Event.type == "ride_completed")
    if since_day is not None:
        q = q.where(Event.day >= since_day)
    events = list(db.scalars(q))
    ids = {e.member_id for e in events} | {r for e in events for r in (e.payload or {}).get("riders", [])}
    members = {m.id: m for m in db.scalars(select(Member).where(Member.id.in_(ids)))} if ids else {}
    out = []
    for e in events:
        riders = [r for r in (e.payload or {}).get("riders", []) if r in members]
        if e.member_id not in members or not riders:
            continue
        trip_id = (e.payload or {}).get("trip_id")
        trip = db.get(Trip, trip_id) if trip_id else None
        if trip:
            km = trip.route_km
        else:
            d = members[e.member_id]
            km = haversine_km(d.home_lat, d.home_lon, d.destination.lat, d.destination.lon)
        out.append(Ride(day=e.day, driver=e.member_id, riders=riders, km=round(km, 1)))
    return out


def _per_member(rides: list[Ride]) -> dict[int, dict]:
    stats: dict[int, dict] = {}
    for r in rides:
        for m in [r.driver, *r.riders]:
            s = stats.setdefault(m, {"rides": 0, "drove": 0, "km": 0.0, "co2": 0.0, "met": set()})
            s["rides"] += 1
            s["km"] += r.km
            s["met"] |= {x for x in [r.driver, *r.riders] if x != m}
        stats[r.driver]["drove"] += 1
        stats[r.driver]["co2"] += r.km * CO2_KG_PER_KM * len(r.riders)   # the driver made these seats possible
        for m in r.riders:
            stats[m]["co2"] += r.km * CO2_KG_PER_KM                       # each rider left a car at home
    return stats


def _week_start(tenant: Tenant) -> int:
    return tenant.current_day - tenant.current_day % 7


def _challenge(db: Session, tenant: Tenant) -> dict:
    start = _week_start(tenant)
    rides = _rides(db, tenant, since_day=max(0, start - 7))
    this_week = sum(1 for r in rides if r.day >= start)
    last_week = sum(1 for r in rides if r.day < start)
    goal = max(10, math.ceil(last_week * 1.2 / 5) * 5)
    seats = sum(len(r.riders) for r in rides if r.day >= start)
    return {"title": f"Share {goal} rides this week", "goal": goal, "progress": this_week, "seats_filled": seats,
            "last_week": last_week, "days_left": 7 - tenant.current_day % 7}


# ---------- demo board: a few posts so the synthetic community feels lived in ----------
DEMO_POSTS = [
    ("ask", "Anyone heading to {dest} from {area} around 8:30 tomorrow? Happy to split fuel.", 25),
    ("offer", "Driving {area} → {dest} every weekday at 8:15. Two seats free, quiet car, ask away.", 140),
    ("thanks", "Huge thanks to {other} for the ride this morning, and for waiting when I was 3 minutes late!", 320),
    ("tip", "Tip: the gate near the bus stop at {dest} is the easiest pickup point. No U-turn needed.", 60 * 24),
    ("update", "Road works on the main road near {area} this week. Leave 10 minutes early.", 60 * 30),
    ("thanks", "Just hit 10 shared rides. Started as a nervous rider, now I drive twice a week. Love this community.", 60 * 52),
]
DEMO_REPLIES = ["Count me in!", "Same time works for me.", "Thanks for the heads up.", "This is so useful.", "See you there!"]


def _seed_demo(db: Session, tenant: Tenant) -> None:
    if not tenant.is_synthetic or db.scalar(select(CommunityPost.id).where(CommunityPost.tenant_id == tenant.id).limit(1)):
        return
    people = list(db.scalars(select(Member).where(Member.tenant_id == tenant.id, Member.state != MemberState.DISCOVERED)
                             .order_by(Member.rides_count.desc()).limit(12)))
    if len(people) < 3:
        return
    rnd = random.Random(tenant.id)
    now = T.now()
    for i, (kind, text, mins_ago) in enumerate(DEMO_POSTS):
        author, other = people[i % len(people)], people[(i + 3) % len(people)]
        post = CommunityPost(tenant_id=tenant.id, author_name=author.name, kind=kind,
                             body=text.format(dest=author.destination.name, area=author.area, other=other.name.split()[0]),
                             created_at=now - timedelta(minutes=mins_ago))
        db.add(post)
        db.flush()
        for emoji in rnd.sample(EMOJIS, k=rnd.randint(1, 3)):
            for _ in range(rnd.randint(1, 6)):
                db.add(PostReaction(post_id=post.id, emoji=emoji))
        for j in range(rnd.randint(0, 2)):
            db.add(PostComment(post_id=post.id, author_name=people[(i + j + 5) % len(people)].name,
                               body=rnd.choice(DEMO_REPLIES), created_at=post.created_at + timedelta(minutes=5 + j * 7)))
    db.commit()


# ---------- reading ----------
@router.get("/overview", summary="Community numbers, this week's challenge and the top riders")
def overview(actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    tenant = _tenant(db, actor)
    rides = _rides(db, tenant)
    week = [r for r in rides if r.day >= _week_start(tenant)]
    joined = db.scalar(select(func.count(Member.id)).where(Member.tenant_id == tenant.id, Member.state != MemberState.DISCOVERED))
    connected = db.scalar(select(func.count(Connection.id)).where(Connection.tenant_id == tenant.id, Connection.kind == "co_ride"))
    return {
        "community": tenant.name,
        "stats": {
            "members": joined, "rides_total": len(rides), "rides_week": len(week),
            "seats_total": sum(len(r.riders) for r in rides),
            "km_total": round(sum(r.km * len(r.riders) for r in rides)),
            "co2_kg": round(sum(r.km * len(r.riders) for r in rides) * CO2_KG_PER_KM),
            "connections": connected,
        },
        "challenge": _challenge(db, tenant),
        "top": leaderboard(period="week", metric="rides", actor=actor, db=db)["rows"][:3],
    }


def _post_out(db: Session, p: CommunityPost, me: int) -> dict:
    counts = dict(db.execute(select(PostReaction.emoji, func.count()).where(PostReaction.post_id == p.id)
                             .group_by(PostReaction.emoji)).all())
    mine = list(db.scalars(select(PostReaction.emoji).where(PostReaction.post_id == p.id, PostReaction.user_id == me)))
    comments = db.scalar(select(func.count(PostComment.id)).where(PostComment.post_id == p.id))
    return {"type": "post", "id": p.id, "kind": p.kind, "body": p.body, "author": p.author_name, "mine": p.user_id == me,
            "created_at": T.utc(p.created_at).isoformat(), "reactions": {e: counts.get(e, 0) for e in EMOJIS},
            "my_reactions": mine, "comments": comments}


def _activity(db: Session, tenant: Tenant) -> list[dict]:
    events = list(db.scalars(select(Event).where(
        Event.tenant_id == tenant.id,
        Event.type.in_(("ride_completed", "member_registered", "first_referral_converted"))).order_by(Event.id.desc()).limit(FEED_LIMIT)))
    ids = {e.member_id for e in events} | {r for e in events for r in (e.payload or {}).get("riders", [])}
    names = dict(db.execute(select(Member.id, Member.name).where(Member.id.in_(ids))).all()) if ids else {}
    out = []
    for e in events:
        who = names.get(e.member_id)
        if not who:
            continue
        if e.type == "ride_completed":
            riders = [names[r].split()[0] for r in (e.payload or {}).get("riders", []) if r in names]
            if not riders:
                continue
            with_ = " and ".join(riders) if len(riders) <= 2 else f"{', '.join(riders[:2])} and {len(riders) - 2} more"
            text, icon = f"{who} shared a ride with {with_}", "ride"
        elif e.type == "member_registered":
            text, icon = f"{who} joined the community", "join"
        else:
            text, icon = f"{who} brought a friend into the community", "invite"
        out.append({"type": "activity", "id": f"e{e.id}", "kind": icon, "text": text, "day": e.day,
                    "created_at": T.utc(e.created_at).isoformat()})
    return out


@router.get("/feed", summary="Posts from members mixed with what's happening in the community")
def feed(actor: Actor = Depends(current_actor), db: Session = Depends(get_db),
         show: str = Query("all", pattern="^(all|posts|activity)$")):
    tenant = _tenant(db, actor)
    _seed_demo(db, tenant)
    items: list[dict] = []
    if show in ("all", "posts"):
        posts = db.scalars(select(CommunityPost).where(CommunityPost.tenant_id == tenant.id)
                           .order_by(CommunityPost.created_at.desc(), CommunityPost.id.desc()).limit(FEED_LIMIT))
        items += [_post_out(db, p, actor.user.id) for p in posts]
    if show in ("all", "activity"):
        items += _activity(db, tenant)
    items.sort(key=lambda i: i["created_at"], reverse=True)
    return {"items": items[:FEED_LIMIT]}


@router.get("/leaderboard", summary="Who shares the most: rides, CO2 saved or people met")
def leaderboard(period: str = Query("week", pattern="^(week|all)$"), metric: str = Query("rides", pattern="^(rides|co2|people)$"),
                actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    tenant = _tenant(db, actor)
    stats = _per_member(_rides(db, tenant, since_day=_week_start(tenant) if period == "week" else None))
    value = {"rides": lambda s: s["rides"], "co2": lambda s: round(s["co2"], 1), "people": lambda s: len(s["met"])}[metric]
    ranked = sorted(stats.items(), key=lambda kv: (-value(kv[1]), -kv[1]["rides"], kv[0]))
    names = dict(db.execute(select(Member.id, Member.name).where(Member.id.in_(list(stats)))).all()) if stats else {}
    me = actor.member_id
    rows, mine = [], None
    for i, (mid, s) in enumerate(ranked, start=1):
        row = {"rank": i, "name": names.get(mid, "Member"), "value": value(s), "rides": s["rides"], "drove": s["drove"], "me": mid == me}
        if i <= 10:
            rows.append(row)
        if mid == me:
            mine = row
    return {"period": period, "metric": metric, "rows": rows, "me": mine}


# ---------- your impact and badges ----------
def _streak(days: set[int], current_day: int) -> int:
    weeks = {d // 7 for d in days}
    w = current_day // 7
    if w not in weeks:
        w -= 1          # this week isn't over yet: a streak can still be alive from last week
    n = 0
    while w in weeks:
        n, w = n + 1, w - 1
    return n


@router.get("/me", summary="Your impact (rides, km, CO2, people met), streak and badges")
def my_impact(actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    tenant = _tenant(db, actor)
    me = actor.member_id
    rides = [r for r in _rides(db, tenant) if me in (r.driver, *r.riders)] if me else []
    s = _per_member(rides).get(me, {"rides": 0, "drove": 0, "km": 0.0, "co2": 0.0, "met": set()})
    streak = _streak({r.day for r in rides}, tenant.current_day)
    invited = db.scalar(select(func.count(Referral.id)).where(Referral.inviter_id == me, Referral.status == "joined")) if me else 0
    posts = db.scalar(select(func.count(CommunityPost.id)).where(CommunityPost.user_id == actor.user.id))
    rating = T.rating_of(db, actor.user.id)
    co2 = round(s["co2"], 1)

    def badge(code: str, label: str, desc: str, have: float, need: float) -> dict:
        return {"code": code, "label": label, "desc": desc, "earned": have >= need, "progress": min(1.0, have / need) if need else 1.0,
                "have": have if isinstance(have, int) else round(have, 1), "need": need}

    badges = [
        badge("first_ride", "First ride", "Share your first ride", s["rides"], 1),
        badge("regular", "Regular", "Share 10 rides", s["rides"], 10),
        badge("driver", "Seat giver", "Drive 5 shared rides", s["drove"], 5),
        badge("social", "Friendly face", "Ride with 5 different people", len(s["met"]), 5),
        badge("streak", "On a roll", "Ride 3 weeks in a row", streak, 3),
        badge("eco", "Planet saver", "Save 25 kg of CO₂", co2, 25),
        badge("connector", "Connector", "Invite someone who joins", invited, 1),
        badge("voice", "Community voice", "Post 3 times on the board", posts, 3),
        badge("star", "Five-star", "Keep a 4.5★ rating over 3+ ratings",
              1 if rating["average"] is not None and rating["average"] >= 4.5 and rating["count"] >= 3 else 0, 1),
    ]
    board = leaderboard(period="all", metric="rides", actor=actor, db=db)
    return {"rides": s["rides"], "drove": s["drove"], "km": round(s["km"]), "co2_kg": co2, "people_met": len(s["met"]),
            "streak_weeks": streak, "rank": board["me"]["rank"] if board["me"] else None, "badges": badges}


# ---------- writing ----------
@router.post("/posts", status_code=201, summary="Post on the community board")
def create_post(body: PostIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    p = CommunityPost(tenant_id=actor.tenant_id, user_id=actor.user.id, author_name=_name(db, actor), kind=body.kind,
                      body=body.body.strip())
    db.add(p)
    db.commit()
    return _post_out(db, p, actor.user.id)


def _post(db: Session, actor: Actor, post_id: int) -> CommunityPost:
    p = db.get(CommunityPost, post_id)
    if not p or p.tenant_id != actor.tenant_id:
        raise HTTPException(404, "This post doesn't exist any more.")
    return p


@router.delete("/posts/{post_id}", summary="Delete your post (organisers can delete any post)")
def delete_post(post_id: int, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    p = _post(db, actor, post_id)
    if p.user_id != actor.user.id and not actor.is_admin:
        raise HTTPException(403, "You can only delete your own posts.")
    db.execute(delete(PostReaction).where(PostReaction.post_id == p.id))
    db.execute(delete(PostComment).where(PostComment.post_id == p.id))
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/reactions", summary="Add or take back a reaction")
def react(post_id: int, body: ReactionIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    p = _post(db, actor, post_id)
    existing = db.scalar(select(PostReaction).where(PostReaction.post_id == p.id, PostReaction.user_id == actor.user.id,
                                                    PostReaction.emoji == body.emoji))
    if existing:
        db.delete(existing)
    else:
        db.add(PostReaction(post_id=p.id, user_id=actor.user.id, emoji=body.emoji))
    db.commit()
    return _post_out(db, p, actor.user.id)


@router.get("/posts/{post_id}/comments", summary="Replies to a post, oldest first")
def comments(post_id: int, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    p = _post(db, actor, post_id)
    rows = db.scalars(select(PostComment).where(PostComment.post_id == p.id).order_by(PostComment.created_at, PostComment.id))
    return [{"id": c.id, "author": c.author_name, "body": c.body, "mine": c.user_id == actor.user.id,
             "created_at": T.utc(c.created_at).isoformat()} for c in rows]


@router.post("/posts/{post_id}/comments", status_code=201, summary="Reply to a post; its author gets an alert")
def comment(post_id: int, body: CommentIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    p = _post(db, actor, post_id)
    name = _name(db, actor)
    c = PostComment(post_id=p.id, user_id=actor.user.id, author_name=name, body=body.body.strip())
    db.add(c)
    if p.user_id and p.user_id != actor.user.id and db.get(User, p.user_id).role != "admin":
        T.alert(db, p.user_id, "community", f"{name} replied to your post", c.body)
    db.commit()
    return {"id": c.id, "author": c.author_name, "body": c.body, "mine": True, "created_at": T.utc(c.created_at).isoformat()}
