"""Form references (spec §3.2): format in app/config/reference.py, numbers in reference_counters
(one row per month `MM-YYYY`, `value` = last number handed out, so each month restarts at 001).
A user-chosen reference does not move the counter (a typo like 10-2026-999 must not exhaust the
sequence); allocate() skips the numbers already taken."""

from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config.reference import current_period, format_reference
from app.models import Form, ReferenceCounter


def taken(db: Session, reference: str) -> bool:
    return bool(db.scalar(select(exists().where(Form.reference == reference))))


def allocate(db: Session, now: datetime | None = None) -> str:
    """Next free reference of the current month. The upsert row-locks the month's counter until
    the caller commits, so concurrent creates get distinct numbers."""
    period = current_period(now)
    bump = (
        insert(ReferenceCounter)
        .values(prefix=period, value=1)
        .on_conflict_do_update(
            index_elements=[ReferenceCounter.prefix], set_={"value": ReferenceCounter.value + 1}
        )
        .returning(ReferenceCounter.value)
    )
    while taken(db, reference := format_reference(period, db.scalar(bump))):
        pass
    return reference


def preview(db: Session, now: datetime | None = None) -> str:
    """What allocate() would return now; not reserved (send `reference: null` to get a number)."""
    period = current_period(now)
    query = select(ReferenceCounter.value).where(ReferenceCounter.prefix == period)
    number = db.scalar(query) or 0
    while taken(db, reference := format_reference(period, number := number + 1)):
        pass
    return reference
