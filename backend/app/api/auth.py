from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select

from app.api.deps import CurrentAuth, Db, client_ip, get_request_ctx
from app.models import Account, Profile
from app.schemas.auth import ActiveProfile, LoginIn, Me
from app.services import activity, auth, passwords, ratelimit, sessions
from app.services.activity import RequestCtx
from app.settings import settings

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/auth/...").
router = APIRouter(tags=["auth"])


def _locked(seconds: int) -> HTTPException:
    return HTTPException(423, auth.lock_message(seconds), headers={"Retry-After": str(seconds)})


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Db) -> Me:
    ip = client_ip(request)
    if not ratelimit.allow(f"login:{ip}", settings.login_rate_limit):
        raise HTTPException(
            429,
            "Trop de tentatives de connexion. Réessayez dans une minute.",
            headers={"Retry-After": str(ratelimit.WINDOW_SECONDS)},
        )
    # Row lock: concurrent attempts on one account are counted one after the other.
    account = db.scalar(select(Account).where(Account.role == body.role).with_for_update())
    if account is None:
        raise HTTPException(401, auth.BAD_CREDENTIALS)
    ctx = RequestCtx(body.role, None, ip)
    now = datetime.now(UTC)
    if remaining := auth.lock_remaining(account, now):
        activity.log(db, ctx, "login_failure", "account", body.role, {"reason": "locked"})
        db.commit()
        raise _locked(remaining)
    if not passwords.verify_password(account.password_hash, body.password):
        locked = auth.record_failure(account, now)
        activity.log(db, ctx, "login_failure", "account", body.role, {"reason": "bad_password"})
        if locked:
            details = {"attempts": account.failed_attempts}
            activity.log(db, ctx, "account_locked", "account", body.role, details)
        db.commit()
        if locked:
            raise _locked(auth.lock_remaining(account, now))
        raise HTTPException(401, auth.BAD_CREDENTIALS)
    auth.record_success(account)
    token = sessions.create(db, account.id)
    activity.log(db, ctx, "login_success", "account", body.role)
    db.commit()
    response.set_cookie(
        sessions.COOKIE, token, httponly=True, secure=True, samesite="strict", path="/"
    )
    return Me(role=body.role, active_profile=None, csrf_token=sessions.csrf_token(token))


@router.get("/auth/me")
def me(current: CurrentAuth, db: Db) -> Me:
    profile_id = current.session.active_profile_id
    profile = db.get(Profile, profile_id) if profile_id else None
    if profile is not None and profile.archived_at is not None:
        profile = None  # same rule as require_active_profile: the user must pick another one
    return Me(
        role=current.role,
        active_profile=ActiveProfile.model_validate(profile) if profile else None,
        csrf_token=current.csrf_token,
    )


@router.post("/auth/logout", status_code=204)
def logout(
    current: CurrentAuth,
    ctx: Annotated[RequestCtx, Depends(get_request_ctx)],
    response: Response,
    db: Db,
) -> None:
    db.delete(current.session)
    activity.log(db, ctx, "logout")
    db.commit()
    response.delete_cookie(sessions.COOKIE, path="/", secure=True, httponly=True, samesite="strict")
