"""Form references (spec §3.2): format in app/config/reference.py, numbers in reference_counters
(`value` = last number handed out). A user-chosen reference does not move the counter (a typo
like FIXME-999999 must not exhaust the sequence); allocate() skips the numbers already taken."""

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config.reference import REFERENCE_PREFIX, format_reference
from app.models import Form, ReferenceCounter


def taken(db: Session, reference: str) -> bool:
    return bool(db.scalar(select(exists().where(Form.reference == reference))))


def allocate(db: Session) -> str:
    """Next free reference. The upsert row-locks the counter until the caller commits, so
    concurrent creates get distinct numbers."""
    bump = (
        insert(ReferenceCounter)
        .values(prefix=REFERENCE_PREFIX, value=1)
        .on_conflict_do_update(
            index_elements=[ReferenceCounter.prefix], set_={"value": ReferenceCounter.value + 1}
        )
        .returning(ReferenceCounter.value)
    )
    while taken(db, reference := format_reference(db.scalar(bump))):
        pass
    return reference


def preview(db: Session) -> str:
    """What allocate() would return now; not reserved (send `reference: null` to get a number)."""
    query = select(ReferenceCounter.value).where(ReferenceCounter.prefix == REFERENCE_PREFIX)
    number = db.scalar(query) or 0
    while taken(db, reference := format_reference(number := number + 1)):
        pass
    return reference
