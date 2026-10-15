"""Sign-up, sign-in, the signed-in member's own data (messages, rides to rate) and ride feedback."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import (DELETED_DOMAIN, Actor, auth_rate_limit, create_token, current_actor, hash_password, is_deleted, member_actor,
                    self_member_id, verify_password)
from .. import mailer
from ..config import get_settings
from ..db import get_db
from ..engine import activation, daycycle, feedback, trips
from ..models import (Alert, Booking, Car, DriverLicence, Member, MemberState, Notification, PasswordReset, Profile, Tenant, Trip, TripSeat,
                      User)
from ..schemas import (DeleteAccountIn, DemoLoginIn, FeedbackIn, ForgotPasswordIn, LoginIn, ReadIn, RegisterIn, ResetPasswordIn,
                       SignupIn)
from .deps import get_tenant, member_out, tenant_out

router = APIRouter(tags=["account"])


def session_out(db: Session, user: User) -> dict:
    tenant = db.get(Tenant, user.tenant_id)
    member = db.get(Member, user.member_id) if user.member_id else None
    names = {d.id: d.name for d in tenant.destinations}
    p = db.get(Profile, user.id)
    return {
        "token": create_token(user),
        "user": {"id": user.id, "email": user.email, "role": user.role, "member_id": user.member_id},
        "profile": {"name": p.name, "gender": p.gender, "mobile": p.mobile, "rating": trips.rating_of(db, user.id),
                    "car": trips.car_of(db, user.id, show_plate=True)} if p else None,
        "tenant": {**tenant_out(tenant), **({"join_code": tenant.join_code} if user.role == "admin" else {})},
        "member": member_out(member, names.get(member.destination_id)) if member else None,
    }


def new_join_code(db: Session) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not db.scalar(select(Tenant.id).where(Tenant.join_code == code)):
            return code


PUBLIC_KIND = "public"


def public_tenant(db: Session) -> Tenant:
    """Where people who sign up without a join code go: one open community for everyone else."""
    t = db.scalar(select(Tenant).where(Tenant.kind == PUBLIC_KIND))
    if not t:
        t = Tenant(name="FellaRide (everyone)", kind=PUBLIC_KIND, center_lat=12.9716, center_lon=77.5946)
        db.add(t)
        db.flush()
    return t


def clean_mobile(mobile: str) -> str:
    return mobile.replace(" ", "").replace("-", "")


@router.post("/auth/login", summary="Sign in with email (or mobile) and password", dependencies=[Depends(auth_rate_limit)])
def login(body: LoginIn, db: Session = Depends(get_db)):
    ident = body.email.strip().lower()
    if "@" in ident:
        user = db.scalar(select(User).where(User.email == ident))
    else:
        user = db.scalar(select(User).join(Profile, Profile.user_id == User.id).where(Profile.mobile == clean_mobile(ident)))
    if not verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(401, "That email and password don’t match an account.")
    return session_out(db, user)


# ---------- forgot password ----------
RESET_MINUTES = 30


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/auth/forgot-password", summary="Email a link to set a new password (same answer whether or not the email exists)",
             dependencies=[Depends(auth_rate_limit)])
def forgot_password(body: ForgotPasswordIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user and not is_deleted(user):
        token = secrets.token_urlsafe(32)
        db.add(PasswordReset(user_id=user.id, token_hash=_token_hash(token),
                             expires_at=datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES)))
        db.commit()
        link = f"{get_settings().app_url.rstrip('/')}/reset-password?token={token}"
        background.add_task(mailer.send, user.email, "Reset your FellaRide password",
                            f"Someone asked to reset the password for your FellaRide account.\n\n"
                            f"Set a new password here (the link works for {RESET_MINUTES} minutes, once):\n{link}\n\n"
                            f"If it wasn't you, ignore this email. Your password stays the same.")
    # the same answer either way, so nobody can find out who has an account
    return {"ok": True, "message": f"If an account uses that email, we’ve sent it a link to set a new password. "
                                   f"The link works for {RESET_MINUTES} minutes."}


@router.post("/auth/reset-password", summary="Set a new password with the emailed link; signs you in",
             dependencies=[Depends(auth_rate_limit)])
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    r = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == _token_hash(body.token)))
    user = db.get(User, r.user_id) if r else None
    expires = None if r is None else r.expires_at if r.expires_at.tzinfo else r.expires_at.replace(tzinfo=timezone.utc)
    if not r or r.used_at or expires < datetime.now(timezone.utc) or not user or is_deleted(user):
        raise HTTPException(400, "This link has expired or was already used. Ask for a new one.")
    user.password_hash = hash_password(body.password)   # also signs out every other session (see auth.password_version)
    for other in db.scalars(select(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None))):
        other.used_at = datetime.now(timezone.utc)
    db.commit()
    return session_out(db, user)


# ---------- delete account ----------
@router.post("/me/delete", summary="Delete your account: open rides are cancelled and your personal details are removed")
def delete_account(body: DeleteAccountIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    user = actor.user
    if user.role == "admin":
        raise HTTPException(403, "Organiser accounts can’t be deleted from the app.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(403, "That password isn’t right.")
    live = ("open", "started")
    driving = list(db.scalars(select(Trip).where(Trip.driver_id == user.id, Trip.status.in_(live))))
    riding = list(db.scalars(select(TripSeat).join(Trip, Trip.id == TripSeat.trip_id).where(
        TripSeat.rider_id == user.id, TripSeat.status.in_(("pending", "approved", "boarded")), Trip.status.in_(live))))
    if any(s.status == "boarded" for s in riding) or any(
            s.status in trips.RODE for t in driving for s in trips.seats(db, t)):
        raise HTTPException(409, "You’re on a ride right now. End it first, then delete your account.")
    try:   # riders and drivers are told, exactly as if you had cancelled or withdrawn yourself
        for t in driving:
            trips.cancel(db, t, user)
        for s in riding:
            trips.withdraw(db, db.get(Trip, s.trip_id), user)
    except trips.TripError as e:
        raise HTTPException(e.status, str(e))
    # Remove what identifies you. Rides and ratings stay (other people's history) under "Deleted user".
    user.email = f"deleted-{user.id}@{DELETED_DOMAIN}"
    user.password_hash = "!deleted"          # matches no password, and ends every session
    p = db.get(Profile, user.id)
    if p:
        p.name, p.gender, p.mobile, p.last_lat, p.last_lon = "Deleted user", "unsaid", None, None, None
    m = db.get(Member, user.member_id) if user.member_id else None
    if m:
        m.name, m.email = "Former member", None
    for model in (Car, DriverLicence, PasswordReset):
        for row in db.scalars(select(model).where(model.user_id == user.id)):
            db.delete(row)
    for a in db.scalars(select(Alert).where(Alert.user_id == user.id)):
        db.delete(a)
    db.commit()
    return {"ok": True}


@router.post("/auth/signup", status_code=201, summary="Create an account: name, gender, email, mobile, password, optional join code",
             dependencies=[Depends(auth_rate_limit)])
def signup(body: SignupIn, db: Session = Depends(get_db)):
    code = (body.join_code or "").strip().upper()
    default = get_settings().default_join_code.strip().upper()
    if not code and default and db.scalar(select(Tenant.id).where(Tenant.join_code == default)):
        code = default   # no code given: join the main community (FELLARIDE_DEFAULT_JOIN_CODE), on its dashboard
    if code:
        tenant = db.scalar(select(Tenant).where(Tenant.join_code == code))
        if not tenant:
            raise HTTPException(404, "No community uses that join code. Leave it empty to join everyone.")
    else:
        tenant = public_tenant(db)
    email, mobile = body.email.strip().lower(), clean_mobile(body.mobile)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    if db.scalar(select(Profile.user_id).where(Profile.mobile == mobile)):
        raise HTTPException(409, "An account with this mobile number already exists. Sign in instead.")
    user = User(tenant_id=tenant.id, email=email, password_hash=hash_password(body.password), role="member")
    db.add(user)
    try:
        db.flush()
        db.add(Profile(user_id=user.id, name=body.name.strip(), gender=body.gender, mobile=mobile))
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email or mobile already exists. Sign in instead.")
    # an invited or imported person claims their member record; with a join code you're registered right away
    activation.safe(db, activation.on_signup, user, bool(code))
    db.commit()
    return session_out(db, user)


@router.post("/auth/register", status_code=201, summary="Join a community with its join code and set up your commute",
             dependencies=[Depends(auth_rate_limit)])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    tenant = db.scalar(select(Tenant).where(Tenant.join_code == body.join_code.upper()))
    if not tenant:
        raise HTTPException(404, "No community uses that join code. Check it with your organiser.")
    if body.destination_id not in {d.id for d in tenant.destinations}:
        raise HTTPException(422, "Pick one of your community’s destinations.")
    if body.has_car and body.seats < 1:
        raise HTTPException(422, "If you drive, offer at least 1 seat.")
    email = body.email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    # Discover -> Register: claim the member the organiser imported (or someone invited) with this email
    m = activation.claimable_member(db, tenant, email)
    if m is None:
        m = Member(tenant_id=tenant.id, email=email, state=MemberState.DISCOVERED, is_synthetic=False)
        db.add(m)
    m.name, m.area, m.home_lat, m.home_lon = body.name.strip(), body.area.strip(), body.home_lat, body.home_lon
    m.destination_id, m.depart_min, m.ride_pref = body.destination_id, body.depart_min, body.ride_pref
    m.has_car, m.seats, m.role_pref = body.has_car, body.seats if body.has_car else 0, "both" if body.has_car else "passenger"
    db.flush()
    activation.register_member(db, tenant, m, via="signup")
    user = User(tenant_id=tenant.id, member_id=m.id, email=email, password_hash=hash_password(body.password), role="member")
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    daycycle.refresh_connectors(db, tenant)
    db.commit()
    return session_out(db, user)


@router.post("/auth/demo-login", summary="Demo only: sign in as a member of a SYNTHETIC community",
             dependencies=[Depends(auth_rate_limit)])
def demo_login(body: DemoLoginIn, db: Session = Depends(get_db)):
    tenant = db.get(Tenant, body.tenant_id)
    if not get_settings().demo_login or not tenant or not tenant.is_synthetic:
        raise HTTPException(404, "Demo sign-in isn’t available for this community.")
    m = db.get(Member, body.member_id)
    if not m or m.tenant_id != tenant.id or not m.is_synthetic or m.state == MemberState.DISCOVERED:
        raise HTTPException(404, "That demo member isn’t available.")
    user = db.scalar(select(User).where(User.member_id == m.id))
    if not user:
        # synthetic test account with no usable password: reachable only through this demo route
        user = User(tenant_id=tenant.id, member_id=m.id, email=f"demo-member-{m.id}-t{tenant.id}@example.edu",
                    password_hash="!", role="member")
        db.add(user)
        db.commit()
    return session_out(db, user)


@router.get("/tenants/{tenant_id}/demo-accounts", summary="Demo only: synthetic members you can sign in as")
def demo_accounts(tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db),
                  q: str = Query("", max_length=40), limit: int = Query(40, ge=1, le=200)):
    if not get_settings().demo_login or not tenant.is_synthetic:
        raise HTTPException(404, "Demo sign-in isn’t available for this community.")
    stmt = select(Member).where(Member.tenant_id == tenant.id, Member.is_synthetic.is_(True),
                                Member.state != MemberState.DISCOVERED)
    if q:
        stmt = stmt.where(Member.name.ilike(f"%{q}%"))
    rows = db.scalars(stmt.order_by(Member.rides_count.desc(), Member.id).limit(limit))
    return [{"id": m.id, "name": m.name, "area": m.area, "has_car": m.has_car, "state": m.state} for m in rows]


@router.get("/auth/me", summary="Who is signed in")
def me(actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    out = session_out(db, actor.user)
    out.pop("token")
    return out


# ---------- the signed-in member's messages ----------
def notif_out(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "day": n.day, "offer_id": n.offer_id,
            "booking_id": n.booking_id, "read": n.read, "created_at": n.created_at.isoformat()}


@router.get("/tenants/{tenant_id}/me/notifications", summary="My messages, newest first")
def my_notifications(actor: Actor = Depends(member_actor), db: Session = Depends(get_db),
                     unread_only: bool = False, limit: int = Query(50, ge=1, le=200)):
    mid = self_member_id(actor)
    stmt = select(Notification).where(Notification.tenant_id == actor.tenant_id, Notification.member_id == mid)
    if unread_only:
        stmt = stmt.where(Notification.read.is_(False))
    rows = list(db.scalars(stmt.order_by(Notification.id.desc()).limit(limit)))
    unread = len(list(db.scalars(select(Notification.id).where(
        Notification.tenant_id == actor.tenant_id, Notification.member_id == mid, Notification.read.is_(False)))))
    return {"unread": unread, "items": [notif_out(n) for n in rows]}


@router.post("/tenants/{tenant_id}/me/notifications/read", summary="Mark my messages as read")
def read_notifications(body: ReadIn, actor: Actor = Depends(member_actor), db: Session = Depends(get_db)):
    mid = self_member_id(actor)
    stmt = update(Notification).where(Notification.tenant_id == actor.tenant_id, Notification.member_id == mid)
    if body.ids:
        stmt = stmt.where(Notification.id.in_(body.ids))
    db.execute(stmt.values(read=True))
    db.commit()
    return {"ok": True}


# ---------- feedback ----------
@router.get("/tenants/{tenant_id}/me/feedback-due", summary="My completed rides from the last week that I haven’t rated")
def feedback_due(actor: Actor = Depends(member_actor), db: Session = Depends(get_db)):
    return feedback.due(db, db.get(Tenant, actor.tenant_id), self_member_id(actor))


@router.post("/tenants/{tenant_id}/rides/bookings/{booking_id}/feedback", status_code=201, summary="Rate a completed ride")
def give_feedback(booking_id: int, body: FeedbackIn, actor: Actor = Depends(member_actor), db: Session = Depends(get_db)):
    tenant = db.get(Tenant, actor.tenant_id)
    b = db.get(Booking, booking_id)
    if not b or b.tenant_id != tenant.id:
        raise HTTPException(404, f"Ride {booking_id} not found in this community.")
    try:
        fb = feedback.submit(db, tenant, b, self_member_id(actor), body.rating, body.tags, body.comment)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except feedback.FeedbackError as e:
        raise HTTPException(409, str(e))
    # the "rate your ride" message for this ride is done
    db.execute(update(Notification).where(Notification.member_id == fb.author_id, Notification.booking_id == b.id,
                                          Notification.kind == "rate_ride").values(read=True))
    db.commit()
    return {"id": fb.id, "booking_id": b.id, "rating": fb.rating, "tags": fb.tags}


@router.get("/join/{join_code}", summary="Look up a community by its join code (for the sign-up screen)",
            dependencies=[Depends(auth_rate_limit)])
def join_lookup(join_code: str, db: Session = Depends(get_db)):
    t = db.scalar(select(Tenant).where(Tenant.join_code == join_code.strip().upper()[:16]))
    if not t:
        raise HTTPException(404, "No community uses that join code. Check it with your organiser.")
    return tenant_out(t)
