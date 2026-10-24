"""Read side of the append-only activity journal (writes go through services/activity.py)."""

import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ActivityLog, Profile
from app.schemas.journal import JournalEntry, JournalPage


def list_entries(
    db: Session,
    *,
    date_from: date | None,
    date_to: date | None,
    action: str | None,
    profile_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> JournalPage:
    """Newest first. Dates are UTC days, both bounds inclusive."""
    where = []
    if date_from:
        where.append(ActivityLog.at >= datetime.combine(date_from, time.min, UTC))
    if date_to:
        where.append(ActivityLog.at < datetime.combine(date_to + timedelta(days=1), time.min, UTC))
    if action:
        where.append(ActivityLog.action == action)
    if profile_id:
        where.append(ActivityLog.profile_id == profile_id)
    total = db.scalar(select(func.count()).select_from(ActivityLog).where(*where))
    rows = db.execute(
        select(ActivityLog, Profile.display_name)
        .outerjoin(Profile, Profile.id == ActivityLog.profile_id)
        .where(*where)
        .order_by(ActivityLog.at.desc(), ActivityLog.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    items = [
        JournalEntry.model_validate(row, from_attributes=True).model_copy(
            update={"profile_name": name}
        )
        for row, name in rows
    ]
    return JournalPage(items=items, total=total, page=page, page_size=page_size)


def distinct_actions(db: Session) -> list[str]:
    return list(db.scalars(select(ActivityLog.action).distinct().order_by(ActivityLog.action)))
