import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from pydantic import AfterValidator
from sqlalchemy import select, text
from sqlalchemy.orm import defer

from app.api.deps import CurrentAuth, Db, get_request_ctx, require_admin
from app.models import Annex, AnnexFolder
from app.pdf import annexes as pdf
from app.schemas.annexes import (
    FolderIn,
    FolderOut,
    FolderUpdate,
    NoteIn,
    NoteOut,
    NoteSummary,
    NoteUpdate,
    TreeOut,
    no_unstorable,
)
from app.services import activity, annexes
from app.services.activity import RequestCtx

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/annexes/...").
# Serves /annexes (notes) and /annex-folders.
router = APIRouter(tags=["annexes"])

ANNEX_MOVE_LOCK = 0x616E6E78  # arbitrary advisory-lock key for folder moves

Ctx = Annotated[RequestCtx, Depends(get_request_ctx)]


def _get(db: Db, annex_id: uuid.UUID) -> Annex:
    annex = db.get(Annex, annex_id)
    if annex is None:
        raise HTTPException(404, "Annexe introuvable.")
    return annex


def _folder(db: Db, folder_id: uuid.UUID) -> AnnexFolder:
    folder = db.get(AnnexFolder, folder_id)
    if folder is None:
        raise HTTPException(404, "Dossier introuvable.")
    return folder


def _changes(body: FolderUpdate | NoteUpdate, nullable: str) -> dict[str, Any]:
    """Fields sent in the PATCH; an explicit null only counts for `nullable` (move to root)."""
    sent = body.model_dump(exclude_unset=True)
    return {k: v for k, v in sent.items() if v is not None or k == nullable}


def _in_use(subject: str, names: list[str]) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": f"Suppression impossible : {subject} par la version publiée de "
            f"{', '.join(names)}.",
            "templates": names,
        },
    )


# --- notes ------------------------------------------------------------------------------------


@router.get("/annexes/tree")
def get_tree(_auth: CurrentAuth, db: Db) -> TreeOut:
    """Both roles. Flat lists: the client builds the tree."""
    folders = db.scalars(select(AnnexFolder).order_by(AnnexFolder.name, AnnexFolder.created_at))
    notes = db.scalars(
        select(Annex).options(defer(Annex.body_html)).order_by(Annex.title, Annex.created_at)
    )
    return TreeOut(
        folders=[FolderOut.model_validate(f) for f in folders],
        notes=[NoteSummary.model_validate(n) for n in notes],
    )


@router.get("/annexes")
def list_annexes(
    _auth: CurrentAuth,
    db: Db,
    q: Annotated[str | None, Query(max_length=200), AfterValidator(no_unstorable)] = None,
) -> list[NoteSummary]:
    """Both roles. `q`: case-insensitive match on title or body text."""
    query = select(Annex).options(defer(Annex.body_html)).order_by(Annex.title, Annex.created_at)
    if q and q.strip():
        term = q.strip()
        query = query.where(
            Annex.title.icontains(term, autoescape=True)
            | Annex.body_text.icontains(term, autoescape=True)
        )
    return [NoteSummary.model_validate(a) for a in db.scalars(query)]


@router.get("/annexes/export.pdf")
def export_pdf(_auth: CurrentAuth, db: Db, folder_id: uuid.UUID | None = None) -> Response:
    """Both roles. The folder's subtree, or the whole tree without `folder_id`."""
    folder = _folder(db, folder_id) if folder_id else None
    try:
        document = pdf.render(db, folder)
    except RecursionError:  # a deeply nested note body overflows the HTML/PDF layout
        raise HTTPException(422, "Une note est trop imbriquée pour être exportée en PDF.") from None
    return Response(
        document,
        media_type="application/pdf",
        headers={
            "Content-Disposition": annexes.content_disposition(
                f"{folder.name if folder else 'Annexes'}.pdf"
            )
        },
    )


@router.get("/annexes/{annex_id}")
def get_annex(_auth: CurrentAuth, db: Db, annex_id: uuid.UUID) -> NoteOut:
    return NoteOut.model_validate(_get(db, annex_id))


@router.post("/annexes", status_code=201, dependencies=[Depends(require_admin)])
def create_annex(db: Db, ctx: Ctx, body: NoteIn) -> NoteOut:
    if body.folder_id is not None:
        _folder(db, body.folder_id)
    html, text = annexes.sanitize(body.body_html)
    annex = Annex(title=body.title, folder_id=body.folder_id, body_html=html, body_text=text)
    db.add(annex)
    db.flush()
    activity.log(db, ctx, "annex_created", "annex", annex.id, {"title": annex.title})
    db.commit()
    return NoteOut.model_validate(annex)


@router.patch("/annexes/{annex_id}", dependencies=[Depends(require_admin)])
def update_annex(db: Db, ctx: Ctx, annex_id: uuid.UUID, body: NoteUpdate) -> NoteOut:
    annex = _get(db, annex_id)
    changes = _changes(body, nullable="folder_id")
    if changes.get("folder_id") is not None:
        _folder(db, changes["folder_id"])
    if "body_html" in changes:
        changes["body_html"], annex.body_text = annexes.sanitize(changes["body_html"])
    for field, value in changes.items():
        setattr(annex, field, value)
    details = {"title": annex.title, "fields": sorted(changes)}
    activity.log(db, ctx, "annex_updated", "annex", annex_id, details)
    db.commit()
    return NoteOut.model_validate(annex)


@router.delete("/annexes/{annex_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_annex(db: Db, ctx: Ctx, annex_id: uuid.UUID) -> Response:
    annex = _get(db, annex_id)
    if names := annexes.referencing_templates(db, {annex_id}):
        return _in_use("annexe utilisée", names)
    db.delete(annex)
    activity.log(db, ctx, "annex_deleted", "annex", annex_id, {"title": annex.title})
    db.commit()
    return Response(status_code=204)


# --- folders ----------------------------------------------------------------------------------


@router.post("/annex-folders", status_code=201, dependencies=[Depends(require_admin)])
def create_folder(db: Db, ctx: Ctx, body: FolderIn) -> FolderOut:
    if body.parent_id is not None:
        _folder(db, body.parent_id)
    folder = AnnexFolder(name=body.name, parent_id=body.parent_id)
    db.add(folder)
    db.flush()
    activity.log(db, ctx, "annex_folder_created", "annex_folder", folder.id, {"name": folder.name})
    db.commit()
    return FolderOut.model_validate(folder)


@router.patch("/annex-folders/{folder_id}", dependencies=[Depends(require_admin)])
def update_folder(db: Db, ctx: Ctx, folder_id: uuid.UUID, body: FolderUpdate) -> FolderOut:
    folder = _folder(db, folder_id)
    changes = _changes(body, nullable="parent_id")
    parent_id = changes.get("parent_id")
    if parent_id is not None:
        _folder(db, parent_id)
        # Serialise moves until commit: two concurrent ones could both pass the check and loop.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": ANNEX_MOVE_LOCK})
        if annexes.would_cycle(db, folder_id, parent_id):
            raise HTTPException(
                422, "Un dossier ne peut pas être déplacé dans lui-même ni dans un sous-dossier."
            )
    for field, value in changes.items():
        setattr(folder, field, value)
    details = {"name": folder.name, "fields": sorted(changes)}
    activity.log(db, ctx, "annex_folder_updated", "annex_folder", folder_id, details)
    db.commit()
    return FolderOut.model_validate(folder)


@router.delete("/annex-folders/{folder_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_folder(db: Db, ctx: Ctx, folder_id: uuid.UUID) -> Response:
    """Deletes the whole subtree (subfolders and notes) through the database cascade."""
    folder = _folder(db, folder_id)
    tree = {folder_id} | annexes.descendants(db, folder_id)
    note_ids = set(db.scalars(select(Annex.id).where(Annex.folder_id.in_(tree))))
    if names := annexes.referencing_templates(db, note_ids):
        return _in_use("des annexes du dossier sont utilisées", names)
    db.delete(folder)
    details = {"name": folder.name, "subfolders": len(tree) - 1, "notes": len(note_ids)}
    activity.log(db, ctx, "annex_folder_deleted", "annex_folder", folder_id, details)
    db.commit()
    return Response(status_code=204)
