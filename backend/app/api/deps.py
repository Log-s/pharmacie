"""Central authorization dependencies. Every route that needs an account goes through
current_auth (directly or via require_*), which also enforces CSRF on unsafe methods."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuthSession, Profile
from app.services import sessions
from app.services.activity import RequestCtx

Db = Annotated[Session, Depends(get_db)]
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass(frozen=True)
class Auth:
    session: AuthSession
    role: str  # "admin" | "user"
    csrf_token: str


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def current_auth(request: Request, db: Db) -> Auth:
    """401 without a live session; 403 when an unsafe method lacks the session's CSRF token."""
    token = request.cookies.get(sessions.COOKIE)
    if not token:
        raise HTTPException(401, "Session absente ou expirée : reconnectez-vous.")
    if request.method not in SAFE_METHODS and not sessions.csrf_ok(
        token, request.headers.get(sessions.CSRF_HEADER)
    ):
        raise HTTPException(403, "Jeton CSRF manquant ou invalide : rechargez la page.")
    loaded = sessions.load(db, token)
    if loaded is None:
        raise HTTPException(401, "Session absente ou expirée : reconnectez-vous.")
    return Auth(loaded[0], loaded[1], sessions.csrf_token(token))


CurrentAuth = Annotated[Auth, Depends(current_auth)]


def require_admin(auth: CurrentAuth) -> Auth:
    if auth.role != "admin":
        raise HTTPException(403, "Action réservée à l'administrateur.")
    return auth


def require_user(auth: CurrentAuth) -> Auth:
    if auth.role != "user":
        raise HTTPException(403, "Action réservée au compte utilisateur.")
    return auth


def require_active_profile(auth: Annotated[Auth, Depends(require_user)], db: Db) -> Profile:
    """The session's active profile; 403 when none is chosen or it has been archived."""
    profile_id = auth.session.active_profile_id
    profile = db.get(Profile, profile_id) if profile_id else None
    if profile is None or profile.archived_at is not None:
        raise HTTPException(403, "Choisissez d'abord un profil.")
    return profile


def require_form_owner_or_admin(loader: Callable[[Session, uuid.UUID], Any]) -> Callable[..., Any]:
    """Dependency factory for form write routes with a `{form_id}` path parameter.
    `loader(db, form_id)` returns the form (with `owner_profile_id`) or None (-> 404).
    Admin always passes; the user passes only when the form belongs to the active profile."""

    def dependency(form_id: uuid.UUID, auth: CurrentAuth, db: Db) -> Any:
        form = loader(db, form_id)
        if form is None:
            raise HTTPException(404, "Fiche introuvable.")
        if auth.role == "admin":
            return form
        if form.owner_profile_id != require_active_profile(auth, db).id:
            raise HTTPException(403, "Cette fiche appartient à un autre profil.")
        return form

    return dependency


def get_request_ctx(request: Request, auth: CurrentAuth) -> RequestCtx:
    """Who acts, for activity.log: the admin never carries a profile."""
    profile_id = auth.session.active_profile_id if auth.role == "user" else None
    return RequestCtx(auth.role, profile_id, client_ip(request))
