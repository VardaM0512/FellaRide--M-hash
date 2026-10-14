"""In-app messages to members. The member app polls these and shows a banner and the inbox."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Member, Notification, RideOffer, Tenant


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def send(db: Session, tenant: Tenant, member_id: int, kind: str, title: str, body: str = "",
         offer_id: int | None = None, booking_id: int | None = None, once_per_day: bool = False) -> Notification | None:
    if once_per_day:
        dup = db.scalar(select(Notification.id).where(
            Notification.tenant_id == tenant.id, Notification.member_id == member_id, Notification.kind == kind,
            Notification.day == tenant.current_day, Notification.title == title))
        if dup:
            return None
    n = Notification(tenant_id=tenant.id, member_id=member_id, day=tenant.current_day, kind=kind,
                     title=title[:160], body=body[:400], offer_id=offer_id, booking_id=booking_id)
    db.add(n)
    return n


def first(name: str) -> str:
    return name.split(" ")[0]


def matched(db: Session, tenant: Tenant, offer: RideOffer, driver: Member, rider: Member, booking_id: int) -> None:
    t = hhmm(offer.depart_min)
    send(db, tenant, rider.id, "matched", f"Matched with {driver.name}",
         f"{first(driver.name)} leaves {driver.area} at {t} and will pick you up on the way.", offer.id, booking_id)
    send(db, tenant, driver.id, "matched", f"{rider.name} joined your {t} ride",
         f"{first(rider.name)} is on your way from {rider.area}. " + (
             "Your car is now full." if offer.seats_left == 0 else f"{offer.seats_left} seat{'s' if offer.seats_left != 1 else ''} still free."), offer.id, booking_id)
