"""Communities (tenants), member import, profiles, clusters, recommendations."""
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Actor, _admin_key_ok, admin_actor, auth_rate_limit, ensure_self, hash_password, member_actor, require_admin_global
from ..db import get_db
from ..engine import daycycle, lifecycle, scorer
from ..engine.context import FEATURES, build_context
from ..engine.matching import recommend_partners
from ..models import Destination, Member, MemberState, Tenant, User
from ..schemas import DemoCreate, MemberImportBatch, TenantCreate
from ..sim.synthetic import create_synthetic_tenant
from .account import new_join_code, session_out
from .deps import get_tenant, member_in, member_out, tenant_out

router = APIRouter(tags=["community"])


@router.post("/tenants", status_code=201, summary="Create a community and its organiser (admin) account",
             dependencies=[Depends(auth_rate_limit)])
def create_tenant(body: TenantCreate, db: Session = Depends(get_db), x_admin_key: str | None = Header(default=None)):
    if body.admin is None and not _admin_key_ok(x_admin_key):
        raise HTTPException(422, "Add the organiser's name, email and password to create a community.")
    if body.admin and db.scalar(select(User.id).where(User.email == body.admin.email.strip().lower())):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    t = Tenant(name=body.name, kind=body.kind, center_lat=body.center_lat, center_lon=body.center_lon,
               join_code=new_join_code(db))
    db.add(t)
    db.flush()
    for d in body.destinations:
        db.add(Destination(tenant_id=t.id, name=d.name, lat=d.lat, lon=d.lon))
    out: dict = {}
    if body.admin:
        admin = User(tenant_id=t.id, email=body.admin.email.strip().lower(), role="admin",
                     password_hash=hash_password(body.admin.password))
        db.add(admin)
        db.flush()
        out = session_out(db, admin)
    db.commit()
    db.refresh(t)
    return {**tenant_out(t), "join_code": t.join_code, **({"session": out} if out else {})}


@router.post("/tenants/demo", status_code=201, summary="Create a SYNTHETIC demo community (180 members)",
             dependencies=[Depends(require_admin_global)])
def create_demo(body: DemoCreate, db: Session = Depends(get_db)):
    t = create_synthetic_tenant(db, seed_active=body.seed_active, seed=body.seed)
    t.join_code = new_join_code(db)
    db.commit()
    db.refresh(t)
    return tenant_out(t)


@router.get("/tenants", summary="List communities (public: names and destinations only)")
def list_tenants(db: Session = Depends(get_db)):
    return [tenant_out(t) for t in db.scalars(select(Tenant).order_by(Tenant.id))]


@router.get("/tenants/{tenant_id}", summary="Get a community")
def get_one(tenant: Tenant = Depends(get_tenant)):
    return tenant_out(tenant)


@router.post("/tenants/{tenant_id}/members/import", status_code=201,
             summary="Admin: import discovered members (from public signals)")
def import_members(body: MemberImportBatch, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                   _: Actor | None = Depends(admin_actor)):
    dest_ids = {d.id for d in tenant.destinations}
    bad = sorted({m.destination_id for m in body.members} - dest_ids)
    if bad:
        raise HTTPException(422, f"Unknown destination id(s) for this community: {bad}")
    created = []
    for m in body.members:
        if m.has_car and m.seats == 0:
            raise HTTPException(422, f"{m.name}: a member with a car needs at least 1 seat.")
        row = Member(tenant_id=tenant.id, name=m.name, area=m.area, home_lat=m.home_lat, home_lon=m.home_lon,
                     destination_id=m.destination_id, depart_min=m.depart_min, has_car=m.has_car,
                     seats=m.seats if m.has_car else 0, role_pref="both" if m.has_car else "passenger",
                     ride_pref=m.ride_pref, state=MemberState.DISCOVERED,
                     email=m.email.strip().lower() if m.email else None)
        db.add(row)
        created.append(row)
    db.flush()
    daycycle.refresh_connectors(db, tenant)
    db.commit()
    return {"imported": len(created), "member_ids": [m.id for m in created]}


@router.post("/tenants/{tenant_id}/members/{member_id}/register", summary="Admin: mark an imported member as signed up")
def register(member_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
             _: Actor | None = Depends(admin_actor)):
    m = member_in(db, tenant, member_id)
    lifecycle.mark_registered(db, m, tenant.current_day)
    db.commit()
    return member_out(m)


@router.get("/tenants/{tenant_id}/members", summary="Admin: list members")
def list_members(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor),
                 state: str | None = Query(None, pattern="^(discovered|registered|interacted|first_ride|repeat|referrer)$"),
                 limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0)):
    q = select(Member).where(Member.tenant_id == tenant.id)
    if state:
        q = q.where(Member.state == state)
    names = {d.id: d.name for d in tenant.destinations}
    return [member_out(m, names.get(m.destination_id)) for m in db.scalars(q.order_by(Member.id).offset(offset).limit(limit))]


@router.get("/tenants/{tenant_id}/members/{member_id}", summary="Member profile with likelihood scores (yourself, or admin)")
def member_profile(member_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                   actor: Actor = Depends(member_actor)):
    ensure_self(actor, member_id)
    m = member_in(db, tenant, member_id)
    ctx = build_context(db, tenant)
    x = ctx.features(m)
    c = ctx.corridor(m.id)
    out = member_out(m, ctx.destinations[m.destination_id].name)
    out["features"] = dict(zip(FEATURES, [round(v, 3) for v in x]))
    out["scores"] = scorer.score_member(scorer.tenant_weights(db, tenant), x)
    out["corridor"] = {"key": c.key, "area": c.area, "size": len(c.member_ids), "registered": c.registered,
                       "drivers": c.drivers, "riders": c.riders, "hot": c.hot}
    out["social_ties"] = len(ctx.ties.get(m.id, ()))
    out["ride_partners"] = len(ctx.partners.get(m.id, ()))
    avg, n = ctx.ratings.get(m.id, (None, 0))
    out["rating"] = {"average": round(avg, 2) if avg is not None else None, "count": n}
    db.commit()
    return out


@router.get("/tenants/{tenant_id}/members/{member_id}/recommendations",
            summary="Recommended ride partners, ranked by match score (yourself, or admin)")
def recommendations(member_id: int, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                    actor: Actor = Depends(member_actor), limit: int = Query(5, ge=1, le=20)):
    ensure_self(actor, member_id)
    m = member_in(db, tenant, member_id)
    ctx = build_context(db, tenant)
    return {"member_id": m.id, "looking_for": "riders" if m.has_car else "drivers",
            "partners": [{"member": member_out(o, ctx.destinations[o.destination_id].name, precise=actor.is_admin),
                          "match": r.as_dict(),
                          "rating": round(ctx.ratings[o.id][0], 1) if o.id in ctx.ratings else None}
                         for o, r in recommend_partners(ctx, m, limit)]}


@router.get("/tenants/{tenant_id}/clusters", summary="Admin: commute corridors (high-potential ride clusters)")
def clusters(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db), _: Actor | None = Depends(admin_actor),
             hot_only: bool = False):
    ctx = build_context(db, tenant)
    names = {d.id: d.name for d in tenant.destinations}
    rows = [{"key": c.key, "area": c.area, "destination": names.get(c.destination_id),
             "window": f"{c.window_start_min // 60:02d}:{c.window_start_min % 60:02d}",
             "size": len(c.member_ids), "registered": c.registered, "drivers": c.drivers, "riders": c.riders,
             "hot": c.hot, "lat": round(c.lat, 5), "lon": round(c.lon, 5), "member_ids": c.member_ids}
            for c in ctx.corridors.values() if c.hot or not hot_only]
    rows.sort(key=lambda r: (r["hot"], r["registered"]), reverse=True)
    return rows
