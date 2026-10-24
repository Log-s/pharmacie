"""Append-only activity journal (spec §6). Every write action goes through log()."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models import ActivityLog


@dataclass(frozen=True)
class RequestCtx:
    """Who acts: account role ('admin', 'user' or None for the server CLI), profile, client IP."""

    account_role: str | None
    profile_id: uuid.UUID | None = None
    ip: str | None = None


CLI = RequestCtx(account_role=None)


def log(
    db: Session,
    ctx: RequestCtx,
    action: str,
    target_type: str | None = None,
    target_id: object = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Adds the row to `db`; the caller commits it with the write it describes."""
    details = dict(details or {})
    if ctx.ip:
        details["ip"] = ctx.ip
    db.add(
        ActivityLog(
            account_role=ctx.account_role,
            profile_id=ctx.profile_id,
            action=action,
            target_type=target_type,
            target_id=None if target_id is None else str(target_id),
            details=details,
        )
    )
