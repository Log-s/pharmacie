"""Server-side sessions. The cookie carries a random token; the table stores only its SHA-256,
so a database leak does not hand out live sessions. The CSRF token is HMAC(secret_key, token):
nothing extra to store, and it dies with the session."""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Account, AuthSession
from app.settings import settings

COOKIE = "session"
CSRF_HEADER = "X-CSRF-Token"


def _id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _expiry() -> datetime:
    return datetime.now(UTC) + timedelta(minutes=settings.session_idle_minutes)


def create(db: Session, account_id: uuid.UUID) -> str:
    """Adds a session for the account and returns the cookie token (caller commits)."""
    token = secrets.token_urlsafe(32)
    db.execute(delete(AuthSession).where(AuthSession.expires_at <= datetime.now(UTC)))
    db.add(AuthSession(id=_id(token), account_id=account_id, expires_at=_expiry()))
    return token


def load(db: Session, token: str) -> tuple[AuthSession, str] | None:
    """(session, account role) for a live token, sliding its expiry and committing; else None."""
    row = db.execute(
        select(AuthSession, Account.role).join(Account).where(AuthSession.id == _id(token))
    ).first()
    if row is None:
        return None
    session, role = row
    if session.expires_at <= datetime.now(UTC):
        db.delete(session)
        db.commit()
        return None
    session.expires_at = _expiry()
    db.commit()
    return session, role


def delete_token(db: Session, token: str) -> None:
    db.execute(delete(AuthSession).where(AuthSession.id == _id(token)))


def delete_for_account(db: Session, account_id: uuid.UUID) -> None:
    db.execute(delete(AuthSession).where(AuthSession.account_id == account_id))


def set_active_profile(db: Session, session: AuthSession, profile_id: uuid.UUID | None) -> None:
    """Stores the active profile in the server session (caller validates it and commits)."""
    session.active_profile_id = profile_id
    db.add(session)


def csrf_token(token: str) -> str:
    return hmac.new(settings.secret_key.encode(), b"csrf:" + token.encode(), "sha256").hexdigest()


def csrf_ok(token: str, header: str | None) -> bool:
    return hmac.compare_digest(csrf_token(token).encode(), (header or "").encode())
