"""Ride feedback: after every completed shared ride, each person rates the other.

Ratings feed back into the engine twice:
- matching: partners with poor average ratings rank lower, well-rated ones slightly higher (Context.rating_factor);
- learning: a happy rider or driver is a weak positive example for their role model (likely to ride/drive again),
  an unhappy one a weak negative example.
"""
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Booking, Event, Member, RideFeedback, Tenant
from . import scorer
from .context import build_context

ALLOWED_TAGS = {"on_time", "friendly", "safe_driving", "smooth_pickup", "clean_car", "late", "no_show", "unsafe", "route_issue"}
FEEDBACK_WINDOW_DAYS = 7


class FeedbackError(ValueError):
    pass


def due(db: Session, tenant: Tenant, member_id: int) -> list[dict]:
    """Completed rides from the last week that this member hasn't rated yet."""
    since = tenant.current_day - FEEDBACK_WINDOW_DAYS
    bookings = list(db.scalars(select(Booking).where(
        Booking.tenant_id == tenant.id, Booking.status == "completed", Booking.day >= since,
        or_(Booking.driver_id == member_id, Booking.rider_id == member_id)).order_by(Booking.day.desc())))
    done = set(db.scalars(select(RideFeedback.booking_id).where(RideFeedback.author_id == member_id)))
    out = []
    for b in bookings:
        if b.id in done:
            continue
        about_id = b.rider_id if b.driver_id == member_id else b.driver_id
        about = db.get(Member, about_id)
        out.append({"booking_id": b.id, "offer_id": b.offer_id, "day": b.day,
                    "you_were": "driver" if b.driver_id == member_id else "rider",
                    "about": {"id": about.id, "name": about.name, "area": about.area}})
    return out


def submit(db: Session, tenant: Tenant, booking: Booking, author_id: int, rating: int, tags: list[str], comment: str) -> RideFeedback:
    if booking.tenant_id != tenant.id:
        raise FeedbackError("Ride not found in this community.")
    if author_id not in (booking.driver_id, booking.rider_id):
        raise PermissionError("You weren't on this ride.")
    if booking.status != "completed":
        raise FeedbackError("You can rate a ride once it is completed.")
    if db.scalar(select(RideFeedback.id).where(RideFeedback.booking_id == booking.id, RideFeedback.author_id == author_id)):
        raise FeedbackError("You already rated this ride.")
    bad = sorted(set(tags) - ALLOWED_TAGS)
    if bad:
        raise FeedbackError(f"Unknown tag(s): {', '.join(bad)}")
    about_id = booking.rider_id if author_id == booking.driver_id else booking.driver_id
    fb = RideFeedback(tenant_id=tenant.id, booking_id=booking.id, author_id=author_id, about_id=about_id,
                      day=tenant.current_day, rating=rating, tags=sorted(set(tags)), comment=comment.strip())
    db.add(fb)
    db.add(Event(tenant_id=tenant.id, member_id=author_id, day=tenant.current_day, type="ride_rated",
                 payload={"booking_id": booking.id, "rating": rating}))
    if rating != 3:
        ctx = build_context(db, tenant)
        role = "driver" if author_id == booking.driver_id else "rider"
        weights = scorer.tenant_weights(db, tenant)
        scorer.learn(weights[role], ctx.features(ctx.members[author_id]), 1 if rating >= 4 else 0,
                     get_settings().learning_rate, 0.25)
    db.flush()
    return fb
