"""FellaRide Community Activation Engine: API entry point.

Run locally:  uvicorn app.main:app --reload     (from the backend/ folder)
Docs:         http://localhost:8000/docs
"""
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import select

from .api import account, community, engagement, expansion, insights, referral, rides, social, trips
from .api.account import public_tenant
from .config import get_settings
from .db import SessionLocal, init_db
from .engine.scorer import load_pretrained
from .auth import hash_password
from .models import Tenant, User
from .sim.behaviour import simulate
from .sim.synthetic import DEMO_NAME, create_neighbour_tenant, create_synthetic_tenant, rename_legacy_demos

log = logging.getLogger("fellaride")


DEMO_ADMIN_EMAIL = "admin@demo.fellaride.app"
DEMO_JOIN_CODE = "DEMO2026"


def seed_demo_if_empty() -> None:
    days = get_settings().seed_demo_days
    if days <= 0:
        return
    with SessionLocal() as db:
        if db.scalar(select(Tenant.id).limit(1)) is not None:
            return
        t = create_synthetic_tenant(db, name=DEMO_NAME)
        t.join_code = DEMO_JOIN_CODE
        # documented test account for evaluators: the demo community's organiser
        db.add(User(tenant_id=t.id, email=DEMO_ADMIN_EMAIL, role="admin",
                    password_hash=hash_password(get_settings().demo_admin_password)))
        db.commit()
        simulate(db, t, days)
        # a second synthetic community nearby, so the expansion engine has someone to link with
        nb = create_neighbour_tenant(db, t)
        db.commit()
        simulate(db, nb, days)
        log.info("Seeded synthetic demo communities %s and %s with %s simulated days", t.id, nb.id, days)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    load_pretrained()   # fail fast if the model file is incompatible
    seed_demo_if_empty()
    with SessionLocal() as db:   # people who sign up without a join code land here
        public_tenant(db)
        rename_legacy_demos(db)
        db.commit()
    if not get_settings().database_url.startswith("sqlite"):
        # work out the welcome page's impact numbers now, off the startup path, so the first visitor doesn't wait
        threading.Thread(target=_warm_impact, daemon=True).start()
    yield


def _warm_impact() -> None:
    from .api.social import compute_impact
    try:
        with SessionLocal() as db:
            compute_impact(db)
    except Exception as e:   # only a speed-up; the endpoint computes on demand anyway
        log.warning("Could not pre-compute the impact numbers: %s", e)


app = FastAPI(
    title="FellaRide Community Activation Engine",
    version="0.1.0",
    description="Discover → Identify → Match → Nudge → Ride → Learn → Refer → Grow. "
                "Endpoints are scoped by community (tenant). Demo communities are synthetic.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
                   allow_methods=["*"], allow_headers=["*"])


# What to tell people when a field fails its format check, instead of the raw regex.
FORMAT_HINTS = {
    "name": "Use letters and spaces only, without < > { } [ ] \\ /.",
    "mobile": "Enter a valid mobile number, e.g. +91 98765 43210.",
    "email": "Enter a valid email address, e.g. name@example.com.",
}


@app.exception_handler(RequestValidationError)
async def invalid_input(_: Request, exc: RequestValidationError):
    # Same {"detail": [{loc, msg, type}]} shape as FastAPI's default, but in plain words and without echoing
    # the submitted input or our validation patterns back.
    detail = []
    for e in exc.errors():
        field = str(e["loc"][-1]) if e.get("loc") else ""
        msg = e.get("msg", "Invalid value.")
        if e.get("type") == "string_pattern_mismatch":
            msg = FORMAT_HINTS.get(field, "Contains characters that aren't allowed.")
        elif e.get("type") == "literal_error":
            msg = "Choose one of the options."
        detail.append({"loc": list(e.get("loc", [])), "msg": msg, "type": e.get("type")})
    return JSONResponse(status_code=422, content={"detail": detail})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    # Never leak stack traces or internals to clients.
    log.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "model_loaded": get_settings().scorer_path.exists()}


for r in (account.router, community.router, rides.router, engagement.router, insights.router, trips.router, social.router, expansion.router, referral.router):
    app.include_router(r, prefix="/api/v1")
