"""Templates and their immutable versions (spec §3.2). Callers commit."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Annex, Template, TemplateVersion
from app.schemas.template_schema import TemplateTree
from app.schemas.templates import AvailableTemplate, TemplateOut, VersionOut
from app.services import activity
from app.services.activity import RequestCtx


def _latest():
    return (
        select(TemplateVersion.template_id, func.max(TemplateVersion.version).label("version"))
        .group_by(TemplateVersion.template_id)
        .subquery()
    )


def latest_number(db: Session, template: Template) -> int | None:
    return db.scalar(
        select(func.max(TemplateVersion.version)).where(TemplateVersion.template_id == template.id)
    )


def out(db: Session, template: Template) -> TemplateOut:
    return TemplateOut(
        id=template.id,
        name=template.name,
        archived_at=template.archived_at,
        latest_version=latest_number(db, template),
    )


def list_all(db: Session) -> list[TemplateOut]:
    latest = _latest()
    rows = db.execute(
        select(Template, latest.c.version)
        .outerjoin(latest, latest.c.template_id == Template.id)
        .order_by(Template.name, Template.id)
    )
    return [
        TemplateOut(id=t.id, name=t.name, archived_at=t.archived_at, latest_version=v)
        for t, v in rows
    ]


def available(db: Session) -> list[AvailableTemplate]:
    """Non-archived templates that have a published version, each with its latest version."""
    latest = _latest()
    rows = db.execute(
        select(Template, TemplateVersion)
        .join(latest, latest.c.template_id == Template.id)
        .join(
            TemplateVersion,
            (TemplateVersion.template_id == Template.id)
            & (TemplateVersion.version == latest.c.version),
        )
        .where(Template.archived_at.is_(None))
        .order_by(Template.name, Template.id)
    )
    return [
        AvailableTemplate(id=t.id, name=t.name, version=VersionOut.model_validate(v))
        for t, v in rows
    ]


def versions(db: Session, template: Template) -> list[TemplateVersion]:
    return list(
        db.scalars(
            select(TemplateVersion)
            .where(TemplateVersion.template_id == template.id)
            .order_by(TemplateVersion.version)
        )
    )


def publish(
    db: Session,
    ctx: RequestCtx,
    template: Template,
    tree: TemplateTree,
    restored_from: int | None = None,
) -> TemplateVersion:
    """Appends version n+1. Lock the template row first (concurrent publishes). Raises
    ValueError (French message listing them) when an annex_ref points to a missing annex."""
    wanted = tree.annex_ids()
    missing = wanted - set(db.scalars(select(Annex.id).where(Annex.id.in_(wanted))))
    if missing:
        ids = ", ".join(sorted(str(i) for i in missing))
        raise ValueError(f"Annexe(s) introuvable(s) : {ids}")
    number = (latest_number(db, template) or 0) + 1
    version = TemplateVersion(
        template_id=template.id, version=number, schema_json=tree.model_dump(mode="json")
    )
    db.add(version)
    db.flush()
    details: dict[str, object] = {"name": template.name, "version": number}
    action = "template_published"
    if restored_from is not None:
        action, details["restored_from"] = "template_restored", restored_from
    activity.log(db, ctx, action, "template", template.id, details)
    return version
