import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError
from sqlalchemy import select
from starlette.datastructures import UploadFile as UploadFile

from app.api.deps import Auth, CurrentAuth, Db, get_request_ctx, require_admin
from app.models import Annex
from app.schemas.annexes import AnnexOut, AnnexUpdate, AnnexUpload
from app.services import activity, annexes
from app.services.activity import RequestCtx
from app.settings import settings

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/annexes/...").
router = APIRouter(tags=["annexes"])

Ctx = Annotated[RequestCtx, Depends(get_request_ctx)]


def _get(db: Db, annex_id: uuid.UUID) -> Annex:
    annex = db.get(Annex, annex_id)
    if annex is None:
        raise HTTPException(404, "Annexe introuvable.")
    return annex


@router.get("/annexes")
def list_annexes(
    _auth: CurrentAuth, db: Db, q: Annotated[str | None, Query(max_length=200)] = None
) -> list[AnnexOut]:
    """Both roles. `q`: case-insensitive match on title or excerpt."""
    query = select(Annex).order_by(Annex.title, Annex.created_at)
    if q and q.strip():
        term = q.strip()
        query = query.where(
            Annex.title.icontains(term, autoescape=True)
            | Annex.excerpt.icontains(term, autoescape=True)
        )
    return [AnnexOut.model_validate(a) for a in db.scalars(query)]


@router.get("/annexes/{annex_id}")
def get_annex(_auth: CurrentAuth, db: Db, annex_id: uuid.UUID) -> AnnexOut:
    return AnnexOut.model_validate(_get(db, annex_id))


@router.get("/annexes/{annex_id}/file")
def get_annex_file(_auth: CurrentAuth, db: Db, annex_id: uuid.UUID) -> FileResponse:
    annex = _get(db, annex_id)
    path = annexes.path_of(annex)
    if not path.is_file():
        raise HTTPException(404, "Le fichier de l'annexe est introuvable sur le serveur.")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": annexes.content_disposition(annex.filename),
            "X-Content-Type-Options": "nosniff",
        },
    )


async def read_upload(
    request: Request, _admin: Annotated[Auth, Depends(require_admin)]
) -> AsyncIterator[tuple[UploadFile, AnnexUpload]]:
    """Parses the multipart body itself, so auth, CSRF and the admin check have already run:
    anonymous and user requests are refused before a byte of the body is read."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > settings.annex_max_bytes + annexes.MULTIPART_OVERHEAD:
        raise HTTPException(413, annexes.too_big_message())
    async with request.form() as form:
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise HTTPException(422, "Le fichier de l'annexe est obligatoire.")
        try:
            fields = AnnexUpload.model_validate({"title": form.get("title")})
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc
        yield file, fields


_UPLOAD_BODY = {
    "required": True,
    "content": {
        "multipart/form-data": {
            "schema": {
                "type": "object",
                "required": ["file"],
                "properties": {
                    "file": {"type": "string", "format": "binary"},
                    "title": {"type": "string", "maxLength": 200},
                },
            }
        }
    },
}


@router.post(
    "/annexes",
    status_code=201,
    dependencies=[Depends(require_admin)],
    openapi_extra={"requestBody": _UPLOAD_BODY},  # the body is parsed by `read_upload`
)
def upload_annex(
    db: Db, ctx: Ctx, upload: Annotated[tuple[UploadFile, AnnexUpload], Depends(read_upload)]
) -> AnnexOut:
    file, fields = upload
    title = fields.title
    annex_id, filename, size, sha256 = annexes.store_pdf(file.file, file.filename)
    path = annexes.path_for(annex_id)
    try:
        annex = Annex(
            id=annex_id,
            title=title or filename[:-4].strip()[:200] or "Annexe",
            filename=filename,
            storage_path=path.name,
            size=size,
            sha256=sha256,
            excerpt=annexes.extract_excerpt(path),
        )
        db.add(annex)
        details = {"title": annex.title, "filename": filename, "size": size, "sha256": sha256}
        activity.log(db, ctx, "annex_uploaded", "annex", annex_id, details)
        db.commit()
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return AnnexOut.model_validate(annex)


@router.patch("/annexes/{annex_id}", dependencies=[Depends(require_admin)])
def update_annex(db: Db, ctx: Ctx, annex_id: uuid.UUID, body: AnnexUpdate) -> AnnexOut:
    annex = _get(db, annex_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(annex, field, value)
    activity.log(db, ctx, "annex_updated", "annex", annex_id, {"fields": sorted(changes)})
    db.commit()
    return AnnexOut.model_validate(annex)


@router.delete("/annexes/{annex_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_annex(db: Db, ctx: Ctx, annex_id: uuid.UUID) -> Response:
    annex = _get(db, annex_id)
    if names := annexes.referencing_templates(db, annex_id):
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Suppression impossible : annexe utilisée par la version publiée de "
                f"{', '.join(names)}.",
                "templates": names,
            },
        )
    details = {"title": annex.title, "filename": annex.filename}
    path = annexes.path_of(annex)
    db.delete(annex)
    activity.log(db, ctx, "annex_deleted", "annex", annex_id, details)
    db.commit()
    path.unlink(missing_ok=True)  # after the commit: an orphan file is harmless, a dangling row not
    return Response(status_code=204)
