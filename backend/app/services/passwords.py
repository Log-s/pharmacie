"""Password policy and Argon2id hashing. Passwords are never logged nor returned."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from zxcvbn import zxcvbn

MIN_LENGTH = 12
MIN_SCORE = 3
_hasher = PasswordHasher()  # argon2-cffi defaults: Argon2id (Type.ID), RFC 9106 low-memory profile


def check_policy(password: str) -> str | None:
    """French error message when the password is too weak, else None."""
    if len(password) < MIN_LENGTH:
        return f"Le mot de passe doit contenir au moins {MIN_LENGTH} caractères."
    if zxcvbn(password, user_inputs=["pharmacie", "admin", "utilisateur"])["score"] < MIN_SCORE:
        return (
            "Mot de passe trop facile à deviner : allongez-le ou combinez plusieurs mots "
            "sans rapport entre eux."
        )
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False
