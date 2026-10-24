"""Forms (spec §3.1): create, read, search, update, delete. Authorization is done by the route
deps; this module checks the data, the reference and journals every write. Callers commit."""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import cast, exists, func, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Auth
from app.models import Form, Profile, Template, TemplateVersion
from app.schemas.forms import FormCreate, FormOut, FormPage, FormSummary, FormUpdate, OwnerOut
from app.schemas.template_schema import TemplateTree
from app.services import activity, form_validation, references
from app.services.activity import RequestCtx

TAKEN = "Cette référence est déjà utilisée par une autre fiche."


@dataclass(frozen=True)
class Filters:
    q: str | None = None  # reference or any text field, case-insensitive substring
    reference: str | None = None
    date_from: date | None = None  # any date field of the form, inclusive
    date_to: date | None = None
    author_id: uuid.UUID | None = None  # any author field of the form
    owner_profile_id: uuid.UUID | None = None
    template_id: uuid.UUID | None = None


def _rows():
    return (
        select(Form, TemplateVersion, Template, Profile)
        .join(TemplateVersion, TemplateVersion.id == Form.template_version_id)
        .join(Template, Template.id == TemplateVersion.template_id)
        .join(Profile, Profile.id == Form.owner_profile_id)
    )


def _field(node_type: str, condition: Any):
    """EXISTS a value in `forms.data` keyed by a node of `node_type` in the bound version's tree
    that satisfies `condition(value_as_text)`."""
    entry = func.jsonb_each_text(Form.data).table_valued("key", "value").alias("entry")
    path = f'lax $.** ? (@.type == "{node_type}").id'  # node_type is a literal of this module
    node_ids = select(func.jsonb_path_query(TemplateVersion.schema_json, cast(path, JSONPATH)))
    node_ids = node_ids.correlate(TemplateVersion)  # the outer row's version, not every version
    return (
        exists()
        .select_from(entry)
        .where(func.to_jsonb(entry.c.key).in_(node_ids), condition(entry.c.value))
    )


def _conditions(f: Filters) -> list[Any]:
    conditions = []
    if f.q:
        conditions.append(
            or_(
                Form.reference.icontains(f.q, autoescape=True),
                _field("text", lambda v: v.icontains(f.q, autoescape=True)),
            )
        )
    if f.reference:
        conditions.append(Form.reference.icontains(f.reference, autoescape=True))
    if f.date_from or f.date_to:
        low, high = (f.date_from or date.min).isoformat(), (f.date_to or date.max).isoformat()
        conditions.append(_field("date", lambda v: v.between(low, high)))
    if f.author_id:
        conditions.append(_field("author", lambda v: v == str(f.author_id)))
    if f.owner_profile_id:
        conditions.append(Form.owner_profile_id == f.owner_profile_id)
    if f.template_id:
        conditions.append(TemplateVersion.template_id == f.template_id)
    return conditions


def can_edit(auth: Auth, owner: Profile) -> bool:
    if auth.role == "admin":
        return True
    return owner.archived_at is None and auth.session.active_profile_id == owner.id


def _summary(auth: Auth, form: Form, version: TemplateVersion, template: Template, owner: Profile):
    return dict(
        id=form.id,
        reference=form.reference,
        template_id=template.id,
        template_name=template.name,
        template_version_id=version.id,
        version=version.version,
        owner=OwnerOut(
            id=owner.id,
            display_name=owner.display_name,
            initials=owner.initials,
            color=owner.color,
            archived=owner.archived_at is not None,
        ),
        created_at=form.created_at,
        updated_at=form.updated_at,
        can_edit=can_edit(auth, owner),
    )


def search(db: Session, auth: Auth, filters: Filters, page: int, page_size: int) -> FormPage:
    conditions = _conditions(filters)
    total = db.scalar(select(func.count()).select_from(_rows().where(*conditions).subquery()))
    rows = db.execute(
        _rows()
        .where(*conditions)
        .order_by(Form.created_at.desc(), Form.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [FormSummary(**_summary(auth, *row)) for row in rows]
    return FormPage(items=items, total=total, page=page, page_size=page_size)


def get(db: Session, auth: Auth, form_id: uuid.UUID) -> FormOut:
    row = db.execute(_rows().where(Form.id == form_id)).one_or_none()
    if row is None:
        raise HTTPException(404, "Fiche introuvable.")
    form, version = row[0], row[1]
    return FormOut(**_summary(auth, *row), data=form.data, schema_json=version.schema_json)


def _clean(db: Session, version: TemplateVersion, data: dict[str, Any]) -> dict[str, Any]:
    clean, errors = form_validation.clean(
        db, TemplateTree.model_validate(version.schema_json), data
    )
    if errors:
        raise HTTPException(422, errors)
    return clean


def _flush(db: Session) -> None:
    """The UNIQUE constraint settles a race the `taken` check could not see."""
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        if getattr(error.orig.diag, "constraint_name", None) == "uq_forms_reference":
            raise HTTPException(409, TAKEN) from None
        raise


def create(db: Session, ctx: RequestCtx, owner: Profile, body: FormCreate) -> Form:
    version = db.get(TemplateVersion, body.template_version_id)
    template = version and db.get(Template, version.template_id)
    if template is None or template.archived_at is not None:
        raise HTTPException(422, "Ce template n'existe pas ou est archivé.")
    data = _clean(db, version, body.data)
    if body.reference and references.taken(db, body.reference):
        raise HTTPException(409, TAKEN)
    reference = body.reference or references.allocate(db)
    form = Form(
        template_version_id=version.id, reference=reference, owner_profile_id=owner.id, data=data
    )
    db.add(form)
    _flush(db)
    details = {"reference": reference, "template": template.name, "version": version.version}
    activity.log(db, ctx, "form_created", "form", form.id, details)
    return form


def update(db: Session, ctx: RequestCtx, form: Form, body: FormUpdate) -> None:
    """Owner and template version stay; an admin edit is journaled as admin (ctx has no profile)."""
    details = {"reference": body.reference}
    if body.reference != form.reference:
        if references.taken(db, body.reference):
            raise HTTPException(409, TAKEN)
        details["previous_reference"] = form.reference
    form.data = _clean(db, db.get(TemplateVersion, form.template_version_id), body.data)
    form.reference = body.reference
    _flush(db)
    activity.log(db, ctx, "form_updated", "form", form.id, details)


def delete(db: Session, ctx: RequestCtx, form: Form) -> None:
    db.delete(form)
    activity.log(db, ctx, "form_deleted", "form", form.id, {"reference": form.reference})
