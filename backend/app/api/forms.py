"""Forms (spec §3.1). Everyone reads; the user creates with an active profile; update/delete go
through require_form_owner_or_admin. Logic in app/services/forms.py."""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import (
    CurrentAuth,
    Db,
    get_request_ctx,
    require_active_profile,
    require_form_owner_or_admin,
)
from app.models import Form, Profile
from app.pdf import render
from app.schemas.forms import (
    FormCreate,
    FormOut,
    FormPage,
    FormUpdate,
    NextReference,
    SearchText,
)
from app.services import activity, references
from app.services import forms as service
from app.services.activity import RequestCtx

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/forms/...").
router = APIRouter(tags=["forms"])
Ctx = Annotated[RequestCtx, Depends(get_request_ctx)]


def load_for_write(db: Db, form_id: uuid.UUID) -> Form | None:
    return db.scalar(select(Form).where(Form.id == form_id).with_for_update())


Writable = Annotated[Form, Depends(require_form_owner_or_admin(load_for_write))]
ActiveProfile = Annotated[Profile, Depends(require_active_profile)]


@router.get("/forms")
def list_forms(
    auth: CurrentAuth,
    db: Db,
    q: SearchText | None = None,
    reference: SearchText | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    author_id: uuid.UUID | None = None,
    owner_profile_id: uuid.UUID | None = None,
    template_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> FormPage:
    filters = service.Filters(
        q, reference, date_from, date_to, author_id, owner_profile_id, template_id
    )
    return service.search(db, auth, filters, page, page_size)


@router.get("/forms/next-reference")
def next_reference(_auth: CurrentAuth, db: Db) -> NextReference:
    """Preview to prefill the reference field; not reserved."""
    return NextReference(reference=references.preview(db))


@router.post("/forms", status_code=201)
def create_form(
    body: FormCreate, profile: ActiveProfile, auth: CurrentAuth, ctx: Ctx, db: Db
) -> FormOut:
    form = service.create(db, ctx, profile, body)
    db.commit()
    return service.get(db, auth, form.id)


@router.get("/forms/{form_id}")
def get_form(form_id: uuid.UUID, auth: CurrentAuth, db: Db) -> FormOut:
    return service.get(db, auth, form_id)


@router.get("/forms/{form_id}/pdf")
def export_pdf(form_id: uuid.UUID, auth: CurrentAuth, ctx: Ctx, db: Db) -> Response:
    form = service.get(db, auth, form_id)
    pdf = render.render(db, form)
    activity.log(db, ctx, "form_export", "form", form.id, {"reference": form.reference})
    db.commit()
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{form.reference}.pdf"'},
    )


@router.put("/forms/{form_id}")
def update_form(body: FormUpdate, form: Writable, auth: CurrentAuth, ctx: Ctx, db: Db) -> FormOut:
    service.update(db, ctx, form, body)
    db.commit()
    return service.get(db, auth, form.id)


@router.delete("/forms/{form_id}", status_code=204)
def delete_form(form: Writable, ctx: Ctx, db: Db) -> None:
    service.delete(db, ctx, form)
    db.commit()
