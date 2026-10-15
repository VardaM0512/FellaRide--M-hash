"""Engine clock: closes a day (expire unmatched demand and unanswered nudges, snapshot metrics) and moves to the next."""
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Connection, Member, Tenant
from . import interventions, metrics, rides

try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo("Asia/Kolkata")
except Exception:            # hosts without a time-zone database (India has no daylight saving)
    LOCAL_TZ = timezone(timedelta(hours=5, minutes=30))
MAX_CATCH_UP = 60            # days closed in one call; a longer gap finishes over the next requests


def close_day(db: Session, tenant: Tenant) -> dict:
    rides.expire_unmatched(db, tenant, tenant.current_day)
    interventions.expire_unanswered(db, tenant, tenant.current_day)
    snap = metrics.snapshot(db, tenant).data
    tenant.current_day += 1
    db.flush()
    return snap


def catch_up(db: Session, tenant: Tenant) -> int:
    """Real communities: one engine day per local calendar day since the community was created. Closes any days
    that have passed. Synthetic communities keep the simulator's clock; an organiser who closed days by hand
    stays ahead until the calendar catches up."""
    if tenant.is_synthetic or not get_settings().auto_advance_days:
        return 0
    created = tenant.created_at if tenant.created_at.tzinfo else tenant.created_at.replace(tzinfo=timezone.utc)
    target = (datetime.now(LOCAL_TZ).date() - created.astimezone(LOCAL_TZ).date()).days
    n = 0
    while tenant.current_day < target and n < MAX_CATCH_UP:
        close_day(db, tenant)
        n += 1
    return n


def refresh_connectors(db: Session, tenant: Tenant, top_share: float = 0.04, min_degree: int = 8,
                       floor_degree: int = 3) -> int:
    """Mark highly connected members (by social ties) as community connectors.
    A connector is in the top `top_share` by ties (with at least `floor_degree` ties) or has `min_degree`+ ties."""
    degree: Counter = Counter()
    for c in db.scalars(select(Connection).where(Connection.tenant_id == tenant.id, Connection.kind == "social")):
        degree[c.a_id] += 1
        degree[c.b_id] += 1
    members = list(db.scalars(select(Member).where(Member.tenant_id == tenant.id)))
    if not members:
        return 0
    ranked = sorted(members, key=lambda m: degree[m.id], reverse=True)
    top = {m.id for m in ranked[:max(1, int(len(members) * top_share))]}
    n = 0
    for m in members:
        m.is_connector = (m.id in top and degree[m.id] >= floor_degree) or degree[m.id] >= min_degree
        n += m.is_connector
    db.flush()
    return n
