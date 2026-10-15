"""Member activation lifecycle. A member only ever moves forward; each step stamps its funnel day."""
from sqlalchemy.orm import Session

from ..models import Event, Member, MemberState

_RANK = {s: i for i, s in enumerate(MemberState.ORDER)}


def _advance(m: Member, new_state: str) -> None:
    if _RANK[new_state] > _RANK[m.state]:
        m.state = new_state


def _event(db: Session, m: Member, day: int, type_: str, **payload) -> None:
    db.add(Event(tenant_id=m.tenant_id, member_id=m.id, day=day, type=type_, payload=payload))


def mark_registered(db: Session, m: Member, day: int, via: str = "signup") -> bool:
    if m.registered_day is not None:
        return False
    m.registered_day = day
    _advance(m, MemberState.REGISTERED)
    _event(db, m, day, "member_registered", via=via)
    return True


def mark_interacted(db: Session, m: Member, day: int, how: str) -> None:
    if m.registered_day is None:
        mark_registered(db, m, day, via=how)
    if m.interacted_day is None:
        m.interacted_day = day
        _advance(m, MemberState.INTERACTED)
        _event(db, m, day, "first_interaction", how=how)


def mark_ride_completed(db: Session, m: Member, day: int) -> None:
    mark_interacted(db, m, day, "ride")
    m.rides_count += 1
    m.last_ride_day = day
    if m.first_ride_day is None:
        m.first_ride_day = day
        _advance(m, MemberState.FIRST_RIDE)
        _event(db, m, day, "first_ride")
    elif m.repeat_day is None and m.rides_count >= 2:
        m.repeat_day = day
        _advance(m, MemberState.REPEAT)
        _event(db, m, day, "repeat_ride")


def mark_referrer(db: Session, m: Member, day: int) -> None:
    if m.referrer_day is None:
        m.referrer_day = day
        _advance(m, MemberState.REFERRER)
        _event(db, m, day, "first_referral_converted")
