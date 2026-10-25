"""Forms API bodies and responses. The `data` format is documented in docs/dev/modules.md (U7)."""

import re
import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, Field
from pydantic_core import PydanticCustomError

from app.config.reference import REFERENCE_HINT, is_valid_reference, reference_example
from app.schemas.template_schema import Strict

# PostgreSQL text/JSONB refuse U+0000; UTF-8 has no encoding for a lone surrogate.
UNSTORABLE = re.compile("[\x00\ud800-\udfff]")


def _storable(value: str) -> str:
    if UNSTORABLE.search(value):
        raise PydanticCustomError("value_error", "Caractère non autorisé.")
    return value


SearchText = Annotated[str, AfterValidator(_storable)]  # free-text query params of GET /api/forms


def _reference(value: str) -> str:
    value = value.strip()
    if not is_valid_reference(value):
        hint = f"{REFERENCE_HINT}, par exemple {reference_example()}"
        raise PydanticCustomError("value_error", f"Référence invalide (format attendu : {hint}).")
    return value


Reference = Annotated[str, AfterValidator(_reference)]


class FormCreate(Strict):
    template_version_id: uuid.UUID
    reference: Reference | None = None  # None: next number from the counter
    data: dict[str, Any] = {}


class FormUpdate(Strict):
    """Full replacement of the editable parts; template version and owner never change."""

    reference: Reference
    data: dict[str, Any] = {}


class OwnerOut(BaseModel):
    id: uuid.UUID
    display_name: str
    number: int
    color: str
    archived: bool  # True: show "Nom (profil supprimé)", the form is read-only for the user


class FormSummary(BaseModel):
    id: uuid.UUID
    reference: str
    template_id: uuid.UUID
    template_name: str
    template_version_id: uuid.UUID
    version: int
    owner: OwnerOut
    created_at: datetime
    updated_at: datetime
    can_edit: bool  # for the caller: admin, or the user whose active profile owns it


class FormOut(FormSummary):
    data: dict[str, Any]
    # The bound version's tree (users cannot read /api/templates/{id}); aliased like VersionOut.
    tree: dict[str, Any] = Field(alias="schema_json")


class FormPage(BaseModel):
    items: list[FormSummary]
    total: int
    page: int
    page_size: int


class NextReference(BaseModel):
    reference: str
