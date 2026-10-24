import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["admin", "user"]
# max_length bounds the Argon2 input; the policy sets the minimum
Password = Annotated[str, Field(max_length=1024)]


class LoginIn(BaseModel):
    role: Role
    password: Password


class ActiveProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    initials: str
    color: str


class Me(BaseModel):
    role: Role
    active_profile: ActiveProfile | None
    csrf_token: str  # send it back in the X-CSRF-Token header on every POST/PUT/PATCH/DELETE


class UserPasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")  # no field can point the route at another account

    password: Password
