"""FellaRide Community Activation Engine: API entry point.

Run locally:  uvicorn app.main:app --reload     (from the backend/ folder)
Docs:         http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import select

from .api import community, engagement, insights, rides
from .config import get_settings
from .db import SessionLocal, init_db
from .engine.scorer import load_pretrained
from .models import Tenant
from .sim.behaviour import simulate
from .sim.synthetic import create_synthetic_tenant

log = logging.getLogger("fellaride")


def seed_demo_if_empty() -> None:
    days = get_settings().seed_demo_days
    if days <= 0:
        return
    with SessionLocal() as db:
        if db.scalar(select(Tenant.id).limit(1)) is not None:
            return
        t = create_synthetic_tenant(db, name="Synthetic University (demo)")
        db.commit()
        simulate(db, t, days)
        log.info("Seeded synthetic demo community %s with %s simulated days", t.id, days)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    load_pretrained()   # fail fast if the model file is incompatible
    seed_demo_if_empty()
    yield


app = FastAPI(
    title="FellaRide Community Activation Engine",
    version="0.1.0",
    description="Discover → Identify → Match → Nudge → Ride → Learn → Refer → Grow. "
                "Endpoints are scoped by community (tenant). Demo communities are synthetic.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    # Never leak stack traces or internals to clients.
    log.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "model_loaded": get_settings().scorer_path.exists()}


for r in (community.router, rides.router, engagement.router, insights.router):
    app.include_router(r, prefix="/api/v1")
