import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Form, Profile


def list_profiles(db: Session, include_archived: bool) -> list[Profile]:
    query = select(Profile).order_by(func.lower(Profile.display_name), Profile.created_at)
    if not include_archived:
        query = query.where(Profile.archived_at.is_(None))
    return list(db.scalars(query))


def get_locked(db: Session, profile_id: uuid.UUID) -> Profile | None:
    """Row lock: a form insert for this profile (FK key-share lock) waits for our commit, so the
    forms count we act on cannot change under us."""
    return db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())


def forms_count(db: Session, profile_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(Form).where(Form.owner_profile_id == profile_id)
    )


def remove(db: Session, profile: Profile) -> tuple[int, bool]:
    """Deletes a profile without forms, archives one that owns forms (forms untouched).
    Returns (forms_count, archived); the caller commits."""
    count = forms_count(db, profile.id)
    if count == 0:
        db.delete(profile)
        return 0, False
    if profile.archived_at is None:
        profile.archived_at = datetime.now(UTC)
    return count, True
