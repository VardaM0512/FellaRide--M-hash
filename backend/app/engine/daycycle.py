"""Engine clock: closes a day (expire unmatched demand, snapshot metrics) and moves to the next."""
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Connection, Member, Tenant
from . import metrics, rides


def close_day(db: Session, tenant: Tenant) -> dict:
    rides.expire_unmatched(db, tenant, tenant.current_day)
    snap = metrics.snapshot(db, tenant).data
    tenant.current_day += 1
    db.flush()
    return snap


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
