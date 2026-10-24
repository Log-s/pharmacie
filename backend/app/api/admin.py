from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import Db, get_request_ctx, require_admin
from app.models import Account
from app.schemas.auth import UserPasswordIn
from app.services import activity, auth
from app.services.activity import RequestCtx

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/admin/...").
router = APIRouter(tags=["admin"])


@router.post("/admin/user-password", status_code=204, dependencies=[Depends(require_admin)])
def set_user_password(
    body: UserPasswordIn, ctx: Annotated[RequestCtx, Depends(get_request_ctx)], db: Db
) -> None:
    """Sets the shared user account's password and closes its sessions. The admin password is
    only reset from the server (python -m app.cli reset-admin-password)."""
    account = db.scalar(select(Account).where(Account.role == "user").with_for_update())
    if account is None:
        raise HTTPException(404, "Compte utilisateur introuvable : l'instance n'est pas installée.")
    try:
        auth.set_password(db, account, body.password)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    activity.log(db, ctx, "password_reset", "account", "user", {"via": "admin"})
    db.commit()
