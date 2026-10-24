"""Account rules shared by the web routes and the CLI: progressive lockout, password changes."""

import math
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Account
from app.services import passwords, sessions
from app.settings import settings

BAD_CREDENTIALS = "Mot de passe incorrect."


def lock_remaining(account: Account, now: datetime) -> int:
    """Seconds left on the account's lockout (0 when not locked)."""
    if account.locked_until is None or account.locked_until <= now:
        return 0
    return math.ceil((account.locked_until - now).total_seconds())


def lock_message(seconds: int) -> str:
    minutes = math.ceil(seconds / 60)
    return (
        "Compte verrouillé après plusieurs échecs de connexion. "
        f"Réessayez dans {minutes} minute{'s' if minutes > 1 else ''}."
    )


def record_failure(account: Account, now: datetime) -> bool:
    """Counts a failed login; from the threshold on, locks for base * 2^extra (capped). True if
    the account is now locked."""
    account.failed_attempts += 1
    extra = account.failed_attempts - settings.lockout_threshold
    if extra < 0:
        return False
    seconds = min(settings.lockout_base_seconds * 2 ** min(extra, 20), settings.lockout_max_seconds)
    account.locked_until = now + timedelta(seconds=seconds)
    return True


def record_success(account: Account) -> None:
    account.failed_attempts = 0
    account.locked_until = None


def set_password(db: Session, account: Account, password: str) -> None:
    """Enforces the policy (ValueError with a French message), stores the new Argon2id hash,
    clears the lockout and closes every session of the account. Caller logs and commits."""
    if error := passwords.check_policy(password):
        raise ValueError(error)
    account.password_hash = passwords.hash_password(password)
    account.password_changed_at = datetime.now(UTC)
    record_success(account)
    sessions.delete_for_account(db, account.id)
