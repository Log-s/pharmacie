import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.template_schema import Label, Strict


class TemplateIn(Strict):
    name: Label


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: uuid.UUID
    version: int
    published_at: datetime
    # A TemplateTree, validated when it was published. Aliased: `schema_json` shadows a
    # (deprecated) BaseModel method; the API and the column both say schema_json.
    tree: dict[str, Any] = Field(alias="schema_json")


class TemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    archived_at: datetime | None
    latest_version: int | None


class TemplateDetail(TemplateOut):
    versions: list[VersionOut]


class AvailableTemplate(BaseModel):
    """User-facing: a non-archived template and its latest version (the one new forms use)."""

    id: uuid.UUID
    name: str
    version: VersionOut
