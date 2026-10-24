import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict
from pydantic_core import PydanticCustomError

COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _fail(message: str) -> PydanticCustomError:
    return PydanticCustomError("value_error", message)  # verbatim: no "Value error," prefix


def _display_name(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 100:
        raise _fail("Le nom affiché est obligatoire (100 caractères au plus).")
    return value


def _initials(value: str) -> str:
    value = value.strip()
    if not 1 <= len(value) <= 3:
        raise _fail("Les initiales doivent comporter de 1 à 3 caractères.")
    return value


def _color(value: str) -> str:
    if not COLOR_RE.fullmatch(value):
        raise _fail("La couleur doit être au format #rrggbb.")
    return value


class ProfileIn(BaseModel):
    """Body of create and update (full replacement)."""

    model_config = ConfigDict(extra="forbid")

    display_name: Annotated[str, AfterValidator(_display_name)]
    initials: Annotated[str, AfterValidator(_initials)]
    color: Annotated[str, AfterValidator(_color)]


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    initials: str
    color: str
    archived_at: datetime | None


class DeletionImpact(BaseModel):
    forms_count: int
    will_archive: bool  # True: the profile owns forms, so deleting it archives it


class DeletionResult(BaseModel):
    forms_count: int
    archived: bool  # False: the profile was removed for good


class SwitchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: uuid.UUID
