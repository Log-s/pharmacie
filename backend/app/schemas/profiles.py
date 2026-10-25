import re
import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field
from pydantic_core import PydanticCustomError

from app.schemas.annexes import no_unstorable

COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _fail(message: str) -> PydanticCustomError:
    return PydanticCustomError("value_error", message)  # verbatim: no "Value error," prefix


def _display_name(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 100:
        raise _fail("Le nom affiché est obligatoire (100 caractères au plus).")
    return value


def _number(value: Any) -> int:
    # JSON integers only ("12" and 12.0 are refused); a missing key arrives here as None (default).
    if type(value) is not int or not 1 <= value <= 999:
        raise _fail("Le numéro doit être un nombre entier de 1 à 999.")
    return value


def _color(value: str) -> str:
    if not COLOR_RE.fullmatch(value):
        raise _fail("La couleur doit être au format #rrggbb.")
    return value


class ProfileIn(BaseModel):
    """Body of create and update (full replacement)."""

    model_config = ConfigDict(extra="forbid")

    display_name: Annotated[str, AfterValidator(no_unstorable), AfterValidator(_display_name)]
    number: Annotated[int, BeforeValidator(_number)] = Field(None, validate_default=True)
    color: Annotated[str, AfterValidator(_color)]


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    number: int
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
