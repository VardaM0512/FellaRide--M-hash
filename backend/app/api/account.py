"""Sign-up, sign-in, the signed-in member's own data (messages, rides to rate) and ride feedback."""
import hashlib
import hmac
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
from ..engine import activation, daycycle, feedback, referral_program, trips
from ..models import (Alert, Booking, Car, DriverLicence, EmailVerification, PayoutInfo, Member, ReferralCode, MemberState, Notification, PasswordReset, Profile, Tenant, Trip, TripSeat,
                      User)
from ..schemas import (DeleteAccountIn, DemoLoginIn, FeedbackIn, LoginIn, ReadIn, RegisterIn,
                       SignupIn, VerifyEmailIn)
from .deps import get_tenant, member_out, tenant_out

router = APIRouter(tags=["account"])


def session_out(db: Session, user: User) -> dict:
    tenant = db.get(Tenant, user.tenant_id)
    member = db.get(Member, user.member_id) if user.member_id else None
    names = {d.id: d.name for d in tenant.destinations}
    p = db.get(Profile, user.id)
    return {
        "token": create_token(user),
        "user": {"id": user.id, "email": user.email, "role": user.role, "member_id": user.member_id,
                 "email_verified": email_verified(db, user), "email_verification_required": verification_required()},
        "profile": {"name": p.name, "gender": p.gender, "mobile": p.mobile, "rating": trips.rating_of(db, user.id),
                    "car": trips.car_of(db, user.id, show_plate=True), "upi_id": trips.upi_of(db, user.id)} if p else None,
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


# ---------- mobile numbers ----------
# One stored format per number, so "98765 43210", "+91 98765-43210", "098765 43210" and "919876543210" are the same
# phone (and the same account): Indian mobiles are kept as +91 and 10 digits, other countries as + and digits.
def clean_mobile(mobile: str) -> str:
    raw = mobile.strip()
    digits = "".join(c for c in raw if c.isdigit())
    if raw.startswith("+"):
        if digits.startswith("910") and len(digits) == 13:   # +91 0XXXXXXXXXX: the trunk 0 doesn't belong
            digits = "91" + digits[3:]
        return "+" + digits
    if len(digits) == 10:
        return "+91" + digits
    if len(digits) == 11 and digits.startswith("0"):
        return "+91" + digits[1:]
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    return digits


def valid_mobile(mobile: str) -> bool:
    """A cleaned number: an Indian mobile (+91, then 10 digits starting 6-9) or another country's (8-15 digits)."""
    if mobile.startswith("+91"):
        return len(mobile) == 13 and mobile[3] in "6789"
    return mobile.startswith("+") and 8 <= len(mobile) - 1 <= 15


def mobile_variants(mobile: str) -> list[str]:
    """The ways the same Indian number may have been saved before numbers were cleaned this way."""
    if not (mobile.startswith("+91") and len(mobile) == 13):
        return [mobile]
    n = mobile[3:]
    return [mobile, n, "0" + n, "91" + n, "+910" + n]


def mobile_owner(db: Session, mobile: str, except_user: int | None = None) -> int | None:
    stmt = select(Profile.user_id).where(Profile.mobile.in_(mobile_variants(mobile)))
    if except_user is not None:
        stmt = stmt.where(Profile.user_id != except_user)
    return db.scalar(stmt.limit(1))


def checked_mobile(mobile: str) -> str:
    m = clean_mobile(mobile)
    if not valid_mobile(m):
        raise HTTPException(422, "Enter a valid mobile number, e.g. +91 98765 43210.")
    return m


# ---------- verifying a new account's email ----------
# Sign-up emails a 6-digit code. While email can actually be sent (an SMTP server is set), posting a ride or asking
# for a seat waits until the code is entered. Without one (local dev, or a host that blocks SMTP) the code only goes
# to the server log, so verifying can't be required and accounts work straight away.
VERIFY_MINUTES = 60
VERIFY_RESEND_SECONDS = 60


def verification_required() -> bool:
    return mailer.configured()


def email_verified(db: Session, user: User) -> bool:
    v = db.get(EmailVerification, user.id)
    return v is None or v.verified_at is not None   # no row: an account from before verification existed


def _verify_hash(user_id: int, code: str) -> str:
    return hashlib.sha256(f"verify-email:{user_id}:{code}".encode()).hexdigest()


def _verify_email(name: str, code: str) -> tuple[str, str]:
    text = (f"Hi {name},\n\nWelcome to FellaRide. Enter this code in the app to confirm your email:\n\n{code}\n\n"
            f"It works for {VERIFY_MINUTES} minutes. If you didn't sign up, ignore this email.\n\nFellaRide")
    html = f"""<!doctype html><html><body style="margin:0;background:#EEEDE8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101418">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#F8F7F3;border-radius:20px;overflow:hidden;border:1px solid #DCDBD4">
<tr><td style="background:#101418;padding:22px 28px;color:#F4F4F1;font-size:20px;font-weight:700">Fella<span style="color:#C9973A">Ride</span></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px;font-size:22px;font-weight:700">Confirm your email</p>
<p style="margin:0 0 22px;color:#5A616B;font-size:15px;line-height:1.5">Hi {name}, welcome to FellaRide. Enter this code in the app:</p>
<p style="margin:0;font-size:34px;letter-spacing:10px;font-weight:700;color:#A87A22;font-family:Menlo,Consolas,monospace">{code}</p>
<p style="margin:26px 0 0;color:#5A616B;font-size:13px;line-height:1.5">It works for {VERIFY_MINUTES} minutes. If you didn't sign up, ignore this email.</p>
</td></tr></table>
<p style="color:#5A616B;font-size:12px;margin:16px 0 0">FellaRide · Community carpooling</p>
</td></tr></table></body></html>"""
    return text, html


def send_verification(db: Session, user: User, background: BackgroundTasks) -> None:
    """A new code (replacing any older one), emailed after the response so sign-up isn't slowed down."""
    code = f"{secrets.randbelow(10 ** 6):06d}"
    v = db.get(EmailVerification, user.id) or EmailVerification(user_id=user.id)
    v.code_hash, v.attempts, v.verified_at = _verify_hash(user.id, code), 0, None
    v.sent_at, v.expires_at = datetime.now(timezone.utc), datetime.now(timezone.utc) + timedelta(minutes=VERIFY_MINUTES)
    db.add(v)
    p = db.get(Profile, user.id)
    first = p.name.split()[0] if p and p.name else "there"
    text, html = _verify_email(first, code)
    background.add_task(mailer.send, user.email, f"{code} is your FellaRide code", text, html)


@router.post("/auth/verify-email/send", summary="Email a new 6-digit code to confirm your email",
             dependencies=[Depends(auth_rate_limit)])
def resend_verification(background: BackgroundTasks, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    user = actor.user
    if email_verified(db, user):
        return {"ok": True, "verified": True}
    v = db.get(EmailVerification, user.id)
    wait = VERIFY_RESEND_SECONDS - (datetime.now(timezone.utc) - _aware(v.sent_at)).total_seconds()
    if wait > 0:
        raise HTTPException(429, f"We just sent a code. You can ask for another in {int(wait) + 1} seconds.")
    send_verification(db, user, background)
    db.commit()
    return {"ok": True, "verified": False, "message": f"We've sent a new code to {user.email}. It works for {VERIFY_MINUTES} minutes."}


@router.post("/auth/verify-email", summary="Confirm your email with the 6-digit code from the sign-up email",
             dependencies=[Depends(auth_rate_limit)])
def verify_email(body: VerifyEmailIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)):
    user = actor.user
    v = db.get(EmailVerification, user.id)
    if v is None or v.verified_at:
        return session_out(db, user)
    if v.attempts >= CODE_TRIES or _aware(v.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(400, "This code has expired. Ask for a new one.")
    if not hmac.compare_digest(v.code_hash, _verify_hash(user.id, body.code)):
        v.attempts += 1
        db.commit()
        left = CODE_TRIES - v.attempts
        raise HTTPException(400, "That code isn’t right." + (f" {left} {'try' if left == 1 else 'tries'} left." if left > 0
                                                              else " Ask for a new one."))
    v.verified_at = datetime.now(timezone.utc)
    db.commit()
    return session_out(db, user)


@router.post("/auth/login", summary="Sign in with email (or mobile) and password", dependencies=[Depends(auth_rate_limit)])
def login(body: LoginIn, db: Session = Depends(get_db)):
    ident = body.email.strip().lower()
    if "@" in ident:
        user = db.scalar(select(User).where(User.email == ident))
    else:
        owner = mobile_owner(db, clean_mobile(ident))
        user = db.get(User, owner) if owner else None
    if not verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(401, "That email and password don’t match an account.")
    return session_out(db, user)


CODE_TRIES = 5   # guesses allowed per email-verification code (used above)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


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
    for model in (Car, DriverLicence, EmailVerification, PasswordReset, PayoutInfo, ReferralCode):
        for row in db.scalars(select(model).where(model.user_id == user.id)):
            db.delete(row)
    for a in db.scalars(select(Alert).where(Alert.user_id == user.id)):
        db.delete(a)
    db.commit()
    return {"ok": True}


@router.post("/auth/signup", status_code=201, summary="Create an account: name, gender, email, mobile, password, optional join code",
             dependencies=[Depends(auth_rate_limit)])
def signup(body: SignupIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    code = (body.join_code or "").strip().upper()
    referrer = referral_program.referrer_by_code(db, body.referral_code)
    if (body.referral_code or "").strip() and referrer is None:
        raise HTTPException(404, "That referral code doesn't exist. Check it, or leave it empty.")
    tenant = None
    if referrer and not code:   # a friend's referral link brings you into their community
        tenant = db.get(Tenant, referrer.tenant_id)
        code = tenant.join_code or ""
    default = get_settings().default_join_code.strip().upper()
    if tenant is None and not code and default and db.scalar(select(Tenant.id).where(Tenant.join_code == default)):
        code = default   # no code given: join the main community (FELLARIDE_DEFAULT_JOIN_CODE), on its dashboard
    if tenant is None and code:
        tenant = db.scalar(select(Tenant).where(Tenant.join_code == code))
        if not tenant:
            raise HTTPException(404, "No community uses that join code. Leave it empty to join everyone.")
    elif tenant is None:
        tenant = public_tenant(db)
    email, mobile = body.email.strip().lower(), checked_mobile(body.mobile)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    if mobile_owner(db, mobile):
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
    send_verification(db, user, background)
    # an invited or imported person claims their member record; with a join code you're registered right away
    activation.safe(db, activation.on_signup, user, bool(code))
    # credit whoever brought them in: their referral link, or an email invite that just converted
    if referrer:
        activation.safe(db, referral_program.record, referrer, user, "link")
    else:
        activation.safe(db, referral_program.credit_email_invite, user)
    db.commit()
    return session_out(db, user)


@router.post("/auth/register", status_code=201, summary="Join a community with its join code and set up your commute",
             dependencies=[Depends(auth_rate_limit)])
def register(body: RegisterIn, background: BackgroundTasks, db: Session = Depends(get_db)):
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
    send_verification(db, user, background)
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
