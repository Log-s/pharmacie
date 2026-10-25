import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Form, Profile


def list_profiles(db: Session, include_archived: bool) -> list[Profile]:
    query = select(Profile).order_by(func.lower(Profile.display_name), Profile.created_at)
    if not include_archived:
        query = query.where(Profile.archived_at.is_(None))
    return list(db.scalars(query))


def flush_unique_number(db: Session, number: int) -> None:
    """Flushes the pending profile write. The partial unique index is the authority on the number
    (it also settles two concurrent writes); a clash becomes the French 409 naming the holder."""
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        holder = db.scalar(
            select(Profile).where(Profile.number == number, Profile.archived_at.is_(None))
        )
        if holder is None:
            raise
        raise HTTPException(
            409, f"Le numéro {number} est déjà attribué au profil {holder.display_name}."
        ) from None


def get_locked(db: Session, profile_id: uuid.UUID) -> Profile | None:
    """Row lock: a form insert for this profile (FK key-share lock) waits for our commit, so the
    forms count we act on cannot change under us."""
    return db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())


def forms_count(db: Session, profile_id: uuid.UUID) -> int:
    """Forms the profile owns or is named in as an `author` value (data = {node id: profile id})."""
    authored = text(
        "EXISTS (SELECT 1 FROM jsonb_each_text(forms.data) AS e WHERE e.value = :profile)"
    ).bindparams(profile=str(profile_id))
    return db.scalar(
        select(func.count())
        .select_from(Form)
        .where(or_(Form.owner_profile_id == profile_id, authored))
    )


def remove(db: Session, profile: Profile) -> tuple[int, bool]:
    """Deletes a profile without fiches, archives one that owns or is the author of fiches.
    Returns (forms_count, archived); the caller commits."""
    count = forms_count(db, profile.id)
    if count == 0:
        db.delete(profile)
        return 0, False
    if profile.archived_at is None:
        profile.archived_at = datetime.now(UTC)
    return count, True
