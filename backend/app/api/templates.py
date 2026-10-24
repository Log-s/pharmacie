"""Templates (spec §3.2): admin writes, versions are append-only (no route updates one)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentAuth, Db, get_request_ctx, require_admin
from app.models import Template, TemplateVersion
from app.schemas.template_schema import TemplateTree
from app.schemas.templates import (
    AvailableTemplate,
    TemplateDetail,
    TemplateIn,
    TemplateOut,
    VersionOut,
)
from app.services import activity
from app.services import templates as service
from app.services.activity import RequestCtx

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/templates/...").
router = APIRouter(tags=["templates"])
Admin = [Depends(require_admin)]
Ctx = Annotated[RequestCtx, Depends(get_request_ctx)]


def load(db: Db, template_id: uuid.UUID, lock: bool = False) -> Template:
    query = select(Template).where(Template.id == template_id)
    template = db.scalar(query.with_for_update() if lock else query)
    if template is None:
        raise HTTPException(404, "Template introuvable.")
    return template


def publish(
    db: Db,
    ctx: RequestCtx,
    template: Template,
    tree: TemplateTree,
    restored_from: int | None = None,
) -> VersionOut:
    try:
        version = service.publish(db, ctx, template, tree, restored_from)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    db.commit()
    return VersionOut.model_validate(version)


@router.get("/templates", dependencies=Admin)
def list_templates(db: Db) -> list[TemplateOut]:
    return service.list_all(db)


@router.get("/templates/available")
def list_available(_auth: CurrentAuth, db: Db) -> list[AvailableTemplate]:
    """Both accounts: what a new form can be created from."""
    return service.available(db)


@router.post("/templates", status_code=201, dependencies=Admin)
def create_template(body: TemplateIn, ctx: Ctx, db: Db) -> TemplateOut:
    template = Template(name=body.name)
    db.add(template)
    db.flush()
    activity.log(db, ctx, "template_created", "template", template.id, {"name": template.name})
    db.commit()
    return service.out(db, template)


@router.get("/templates/{template_id}", dependencies=Admin)
def get_template(template_id: uuid.UUID, db: Db) -> TemplateDetail:
    template = load(db, template_id)
    versions = [VersionOut.model_validate(v) for v in service.versions(db, template)]
    return TemplateDetail(**service.out(db, template).model_dump(), versions=versions)


@router.post("/templates/{template_id}/versions", status_code=201, dependencies=Admin)
def publish_version(template_id: uuid.UUID, body: TemplateTree, ctx: Ctx, db: Db) -> VersionOut:
    return publish(db, ctx, load(db, template_id, lock=True), body)


@router.post(
    "/templates/{template_id}/versions/{version}/restore", status_code=201, dependencies=Admin
)
def restore_version(template_id: uuid.UUID, version: int, ctx: Ctx, db: Db) -> VersionOut:
    """Republishes an older version's tree as a new version (annexes are checked again)."""
    template = load(db, template_id, lock=True)
    old = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template.id, TemplateVersion.version == version
        )
    )
    if old is None:
        raise HTTPException(404, "Version introuvable.")
    tree = TemplateTree.model_validate(old.schema_json)
    return publish(db, ctx, template, tree, restored_from=version)


@router.post("/templates/{template_id}/archive", dependencies=Admin)
def archive_template(template_id: uuid.UUID, ctx: Ctx, db: Db) -> TemplateOut:
    template = load(db, template_id, lock=True)
    if template.archived_at is None:
        template.archived_at = datetime.now(UTC)
        activity.log(db, ctx, "template_archived", "template", template.id, {"name": template.name})
        db.commit()
    return service.out(db, template)


@router.delete("/templates/{template_id}", status_code=204, dependencies=Admin)
def delete_template(template_id: uuid.UUID, ctx: Ctx, db: Db) -> None:
    template = load(db, template_id, lock=True)
    details = {"name": template.name}
    try:
        # Versions cascade; forms.template_version_id is ON DELETE RESTRICT, so a used one fails.
        db.delete(template)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Ce template est utilisé par des fiches : archivez-le au lieu de le supprimer."
        ) from None
    activity.log(db, ctx, "template_deleted", "template", template_id, details)
    db.commit()
