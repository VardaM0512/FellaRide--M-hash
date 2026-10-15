"""Authentication: bcrypt password hashes, signed JWT access tokens, and who-may-do-what checks.

Every member action takes the acting member from the token, never from the URL or body:
a member can only read and change their own data; an admin can see and run their own community.
"""
import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Tenant, User

log = logging.getLogger("fellaride.auth")
ALGORITHM = "HS256"
_generated_secret = secrets.token_urlsafe(48)
_warned = False


def _secret() -> str:
    global _warned
    s = get_settings().jwt_secret
    if s:
        return s
    if not _warned:
        log.warning("FELLARIDE_JWT_SECRET is not set: using a random secret, so logins end when the server restarts.")
        _warned = True
    return _generated_secret


# ---------- passwords ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


_DUMMY = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    """Constant-ish time: an unknown email still costs one bcrypt check (no user enumeration by timing)."""
    try:
        ok = bcrypt.checkpw(password.encode("utf-8"), (hashed or _DUMMY).encode())
    except ValueError:   # unusable hash (e.g. demo accounts with no password)
        bcrypt.checkpw(password.encode("utf-8"), _DUMMY.encode())
        return False
    return ok and hashed is not None


# ---------- tokens ----------
DELETED_DOMAIN = "deleted.invalid"   # a deleted account's email becomes deleted-<id>@deleted.invalid


def is_deleted(user: User) -> bool:
    return user.email.endswith("@" + DELETED_DOMAIN)


def password_version(user: User) -> str:
    """Changes whenever the password does, so a reset (or deleting the account) signs out every old session."""
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:12]


def create_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "tid": user.tenant_id, "role": user.role, "mid": user.member_id,
               "pv": password_version(user), "iat": now, "exp": now + timedelta(hours=get_settings().jwt_expire_hours)}
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


@dataclass
class Actor:
    user: User
    tenant_id: int
    member_id: int | None
    is_admin: bool


def _unauthorized(msg: str = "Please sign in again."):
    return HTTPException(401, msg, headers={"WWW-Authenticate": "Bearer"})


def current_actor(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Actor:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Sign in to continue.")
    try:
        payload = jwt.decode(authorization[7:], _secret(), algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise _unauthorized()
    # re-read the user so deleted accounts and role changes take effect immediately
    user = db.get(User, user_id)
    if not user or is_deleted(user):
        raise _unauthorized()
    if "pv" in payload and not hmac.compare_digest(str(payload["pv"]), password_version(user)):
        raise _unauthorized("Your password was changed. Please sign in again.")
    return Actor(user=user, tenant_id=user.tenant_id, member_id=user.member_id, is_admin=user.role == "admin")


def _tenant_from_path(tenant_id: int, db: Session) -> Tenant:
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(404, f"Community {tenant_id} not found.")
    return t


def member_actor(tenant_id: int, actor: Actor = Depends(current_actor), db: Session = Depends(get_db)) -> Actor:
    """Any signed-in person of THIS community. Other communities get a 404, as if it didn't exist."""
    _tenant_from_path(tenant_id, db)
    if actor.tenant_id != tenant_id:
        raise HTTPException(404, f"Community {tenant_id} not found.")
    return actor


def _admin_key_ok(key: str | None) -> bool:
    configured = get_settings().admin_key
    return bool(configured and key and hmac.compare_digest(key, configured))


def admin_actor(tenant_id: int, authorization: str | None = Header(default=None),
                x_admin_key: str | None = Header(default=None), db: Session = Depends(get_db)) -> Actor | None:
    """The community's admin (JWT with role admin), or the operator X-Admin-Key for scripts."""
    if _admin_key_ok(x_admin_key):
        _tenant_from_path(tenant_id, db)
        return None
    actor = member_actor(tenant_id, current_actor(authorization, db), db)
    if not actor.is_admin:
        raise HTTPException(403, "Only the community admin can do this.")
    return actor


def require_admin_global(authorization: str | None = Header(default=None), x_admin_key: str | None = Header(default=None),
                         db: Session = Depends(get_db)) -> None:
    """For routes not tied to one community (create demo, compare): any community admin, or the operator key."""
    if _admin_key_ok(x_admin_key):
        return
    actor = current_actor(authorization, db)
    if not actor.is_admin:
        raise HTTPException(403, "Only a community admin can do this.")


def ensure_self(actor: Actor | None, member_id: int) -> None:
    """Members may only act as themselves; admins (or the operator key, actor=None) may act on anyone in their community."""
    if actor is None or actor.is_admin:
        return
    if actor.member_id != member_id:
        raise HTTPException(403, "You can only do this for your own account.")


def self_member_id(actor: Actor) -> int:
    if actor.member_id is None:
        raise HTTPException(403, "This account is not a community member.")
    return actor.member_id


# ---------- tiny in-memory rate limiter for sign-in endpoints ----------
_hits: dict[str, deque] = defaultdict(deque)


def auth_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    window, limit, now = 600.0, get_settings().auth_rate_limit, time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many sign-in attempts. Wait a few minutes and try again.")
    q.append(now)
