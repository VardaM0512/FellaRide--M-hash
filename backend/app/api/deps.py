"""Shared dependencies: tenant scoping, member lookup, admin guard, serializers."""
import hmac

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Member, Tenant


def get_tenant(tenant_id: int, db: Session = Depends(get_db)) -> Tenant:
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(404, f"Community {tenant_id} not found.")
    return t


def member_in(db: Session, tenant: Tenant, member_id: int) -> Member:
    """Fetch a member and enforce that it belongs to the tenant in the URL (prevents cross-tenant access)."""
    m = db.get(Member, member_id)
    if not m or m.tenant_id != tenant.id:
        raise HTTPException(404, f"Member {member_id} not found in this community.")
    return m


def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    key = get_settings().admin_key
    if key and not (x_admin_key and hmac.compare_digest(x_admin_key, key)):
        raise HTTPException(401, "This action needs a valid X-Admin-Key header.")


def member_out(m: Member, dest_name: str | None = None) -> dict:
    """Public member view. Email is deliberately never returned."""
    return {
        "id": m.id, "name": m.name, "area": m.area, "state": m.state,
        "home": {"lat": round(m.home_lat, 5), "lon": round(m.home_lon, 5)},
        "destination_id": m.destination_id, "destination": dest_name,
        "depart_time": f"{m.depart_min // 60:02d}:{m.depart_min % 60:02d}", "depart_min": m.depart_min,
        "has_car": m.has_car, "seats": m.seats, "ride_pref": m.ride_pref, "is_connector": m.is_connector,
        "rides_count": m.rides_count, "last_ride_day": m.last_ride_day,
        "nudges_received": m.nudges_received, "nudges_responded": m.nudges_responded,
        "funnel": {"registered_day": m.registered_day, "interacted_day": m.interacted_day,
                   "first_ride_day": m.first_ride_day, "repeat_day": m.repeat_day, "referrer_day": m.referrer_day},
        "synthetic": m.is_synthetic,
    }


def tenant_out(t: Tenant) -> dict:
    return {"id": t.id, "name": t.name, "kind": t.kind, "center": {"lat": t.center_lat, "lon": t.center_lon},
            "current_day": t.current_day, "synthetic": t.is_synthetic,
            "destinations": [{"id": d.id, "name": d.name, "lat": d.lat, "lon": d.lon} for d in t.destinations]}
