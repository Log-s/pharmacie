import dataclasses
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import Auth, CurrentAuth, Db, get_request_ctx, require_admin, require_user
from app.models import Profile
from app.schemas.auth import ActiveProfile, Me
from app.schemas.profiles import (
    DeletionImpact,
    DeletionResult,
    ProfileIn,
    ProfileOut,
    SwitchIn,
)
from app.services import activity, profiles, sessions
from app.services.activity import RequestCtx

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/profiles/...").
router = APIRouter(tags=["profiles"])

Ctx = Annotated[RequestCtx, Depends(get_request_ctx)]


def _not_found() -> HTTPException:
    return HTTPException(404, "Profil introuvable.")


def _locked_or_404(db: Db, profile_id: uuid.UUID) -> Profile:
    profile = profiles.get_locked(db, profile_id)
    if profile is None:
        raise _not_found()
    return profile


@router.get("/profiles")
def list_profiles(auth: CurrentAuth, db: Db, include_archived: bool = False) -> list[ProfileOut]:
    """Active profiles for any session; `include_archived` is for the admin."""
    if include_archived and auth.role != "admin":
        raise HTTPException(403, "Action réservée à l'administrateur.")
    return [ProfileOut.model_validate(p) for p in profiles.list_profiles(db, include_archived)]


@router.post("/profiles", status_code=201, dependencies=[Depends(require_admin)])
def create_profile(body: ProfileIn, ctx: Ctx, db: Db) -> ProfileOut:
    profile = Profile(**body.model_dump())
    db.add(profile)
    profiles.flush_unique_number(db, body.number)
    activity.log(db, ctx, "profile_create", "profile", profile.id, body.model_dump())
    db.commit()
    return ProfileOut.model_validate(profile)


@router.put("/profiles/{profile_id}", dependencies=[Depends(require_admin)])
def update_profile(profile_id: uuid.UUID, body: ProfileIn, ctx: Ctx, db: Db) -> ProfileOut:
    profile = _locked_or_404(db, profile_id)
    before = {k: getattr(profile, k) for k in ProfileIn.model_fields}
    for key, value in body.model_dump().items():
        setattr(profile, key, value)
    profiles.flush_unique_number(db, body.number)
    activity.log(
        db,
        ctx,
        "profile_update",
        "profile",
        profile.id,
        {"before": before, "after": body.model_dump()},
    )
    db.commit()
    return ProfileOut.model_validate(profile)


@router.get("/profiles/{profile_id}/deletion-impact", dependencies=[Depends(require_admin)])
def deletion_impact(profile_id: uuid.UUID, db: Db) -> DeletionImpact:
    if db.get(Profile, profile_id) is None:
        raise _not_found()
    count = profiles.forms_count(db, profile_id)
    return DeletionImpact(forms_count=count, will_archive=count > 0)


@router.delete("/profiles/{profile_id}", dependencies=[Depends(require_admin)])
def delete_profile(profile_id: uuid.UUID, ctx: Ctx, db: Db) -> DeletionResult:
    """No forms: hard delete. Otherwise archive (forms stay, readable as "(profil supprimé)")."""
    profile = _locked_or_404(db, profile_id)
    count, archived = profiles.remove(db, profile)
    action = "profile_archive" if archived else "profile_delete"
    details = {"display_name": profile.display_name, "forms_count": count}
    activity.log(db, ctx, action, "profile", profile_id, details)
    db.commit()
    return DeletionResult(forms_count=count, archived=archived)


@router.post("/session/profile")
def switch_profile(
    body: SwitchIn, auth: Annotated[Auth, Depends(require_user)], ctx: Ctx, db: Db
) -> Me:
    profile = db.get(Profile, body.profile_id)
    if profile is None:
        raise _not_found()
    if profile.archived_at is not None:
        raise HTTPException(409, "Ce profil est archivé : choisissez un autre profil.")
    previous = auth.session.active_profile_id
    sessions.set_active_profile(db, auth.session, profile.id)
    details = {"from": None if previous is None else str(previous), "to": str(profile.id)}
    new_ctx = dataclasses.replace(ctx, profile_id=profile.id)
    activity.log(db, new_ctx, "profile_switch", "profile", profile.id, details)
    db.commit()
    return Me(
        role=auth.role,
        active_profile=ActiveProfile.model_validate(profile),
        csrf_token=auth.csrf_token,
    )
