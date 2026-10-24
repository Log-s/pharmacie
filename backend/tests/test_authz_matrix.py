"""Authorization matrix (spec §11). Later units add their routes to ADMIN_ONLY / USER_ONLY."""

import re
import uuid
from types import SimpleNamespace
from typing import Annotated, Any

import pytest
from fastapi import Depends, FastAPI
from sqlalchemy import func, select

from app.api.deps import (
    get_request_ctx,
    require_active_profile,
    require_form_owner_or_admin,
)
from app.main import app
from app.models import Account, ActivityLog, AuthSession, Profile
from app.services import passwords, sessions
from app.services.activity import RequestCtx
from tests.conftest import PASSWORDS

NEW_USER_PW = "girafe-tunnel-paprika-93"
ADMIN_ONLY = [("POST", "/api/admin/user-password", {"password": NEW_USER_PW})]
PUBLIC_WRITES = {("POST", "/api/auth/login")}
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def write_routes() -> list[tuple[str, str]]:
    """(METHOD, path with dummy ids) of every write route, from the OpenAPI schema: it lists the
    routes of every included router (FastAPI no longer flattens them into app.routes)."""
    return [
        (method.upper(), re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path))
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method.upper() in WRITE_METHODS
    ]


def account(db, role: str) -> Account:
    db.expire_all()
    return db.scalar(select(Account).where(Account.role == role))


def user_session_count(db) -> int:
    return db.scalar(
        select(func.count()).select_from(AuthSession).join(Account).where(Account.role == "user")
    )


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ONLY)
def test_user_gets_403_on_admin_routes(user_client, method, path, body):
    assert user_client.request(method, path, json=body).status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ONLY)
def test_anonymous_gets_401_on_admin_routes(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 401


def test_every_write_route_requires_a_session_and_csrf(client, make_client):
    """Guard for every unit: a write route outside the central deps is a bug (and skips CSRF)."""
    routes = [r for r in write_routes() if r not in PUBLIC_WRITES]
    assert ("POST", "/api/admin/user-password") in routes
    no_csrf = make_client("admin")
    del no_csrf.headers[sessions.CSRF_HEADER]
    statuses = {
        r: (client.request(*r, json={}).status_code, no_csrf.request(*r, json={}).status_code)
        for r in routes
    }
    assert {r: s for r, s in statuses.items() if s != (401, 403)} == {}


def test_admin_sets_the_user_password(make_client, admin_client, db):
    old_user_clients = [make_client("user"), make_client("user")]
    response = admin_client.post("/api/admin/user-password", json={"password": NEW_USER_PW})
    assert response.status_code == 204
    assert passwords.verify_password(account(db, "user").password_hash, NEW_USER_PW)
    assert user_session_count(db) == 0
    assert all(c.get("/api/auth/me").status_code == 401 for c in old_user_clients)
    assert admin_client.get("/api/auth/me").status_code == 200
    row = db.scalar(select(ActivityLog))
    assert (row.action, row.account_role, row.target_id, row.details["via"]) == (
        "password_reset",
        "admin",
        "user",
        "admin",
    )


def test_admin_user_password_enforces_the_policy(make_client, admin_client, db):
    make_client("user")
    response = admin_client.post("/api/admin/user-password", json={"password": "motdepasse12"})
    assert response.status_code == 422
    assert "trop facile" in response.json()["detail"]
    assert passwords.verify_password(account(db, "user").password_hash, PASSWORDS["user"])
    assert user_session_count(db) == 1


def test_admin_user_password_cannot_target_the_admin(admin_client, db):
    for body in (
        {"password": NEW_USER_PW, "role": "admin"},
        {"password": NEW_USER_PW, "account_id": str(account(db, "admin").id)},
    ):
        assert admin_client.post("/api/admin/user-password", json=body).status_code == 422
    assert passwords.verify_password(account(db, "admin").password_hash, PASSWORDS["admin"])


def test_no_web_route_resets_the_admin_password(make_client, db):
    """Hits every write route, as admin and as user, with password-shaped payloads."""
    original = account(db, "admin").password_hash
    body = {
        "password": NEW_USER_PW,
        "new_password": NEW_USER_PW,
        "role": "admin",
        "account": "admin",
        "account_id": str(account(db, "admin").id),
    }
    routes = write_routes()
    assert ("POST", "/api/auth/login") in routes
    for method, path in routes:
        for role in ("admin", "user"):
            make_client(role).request(method, path, json=body)
    assert account(db, "admin").password_hash == original
    assert passwords.verify_password(original, PASSWORDS["admin"])


# --- central deps, on a probe app (U4/U7 plug real routes into them) --------------------------

FORMS: dict[uuid.UUID, SimpleNamespace] = {}
probe = FastAPI()


def load_form(_db, form_id: uuid.UUID):
    return FORMS.get(form_id)


@probe.post("/profile-write")
def profile_write(profile: Annotated[Profile, Depends(require_active_profile)]) -> dict:
    return {"profile": str(profile.id)}


@probe.post("/forms/{form_id}")
def form_write(form: Annotated[Any, Depends(require_form_owner_or_admin(load_form))]) -> dict:
    return {"owner": str(form.owner_profile_id)}


@probe.get("/ctx")
def ctx(request_ctx: Annotated[RequestCtx, Depends(get_request_ctx)]) -> dict:
    return {"role": request_ctx.account_role, "profile": str(request_ctx.profile_id)}


def test_write_without_active_profile_is_403(make_client, profile_factory):
    assert make_client("user", app=probe).post("/profile-write").status_code == 403
    archived = profile_factory(archived=True)
    assert make_client("user", archived, app=probe).post("/profile-write").status_code == 403
    assert make_client("admin", app=probe).post("/profile-write").status_code == 403


def test_require_active_profile_returns_it(make_client, profile_factory):
    profile = profile_factory()
    response = make_client("user", profile, app=probe).post("/profile-write")
    assert response.json() == {"profile": str(profile.id)}


def test_form_owner_or_admin(make_client, profile_factory):
    owner, other = profile_factory("A", "A"), profile_factory("B", "B")
    form_id = uuid.uuid4()
    FORMS[form_id] = SimpleNamespace(owner_profile_id=owner.id)
    path = f"/forms/{form_id}"
    try:
        assert make_client("admin", app=probe).post(path).status_code == 200
        assert make_client("user", owner, app=probe).post(path).status_code == 200
        assert make_client("user", other, app=probe).post(path).status_code == 403
        assert make_client("user", app=probe).post(path).status_code == 403
        assert make_client("admin", app=probe).post(f"/forms/{uuid.uuid4()}").status_code == 404
    finally:
        FORMS.clear()


def test_request_ctx_attributes_the_actor(make_client, profile_factory):
    profile = profile_factory()
    assert make_client("user", profile, app=probe).get("/ctx").json() == {
        "role": "user",
        "profile": str(profile.id),
    }
    assert make_client("admin", app=probe).get("/ctx").json() == {
        "role": "admin",
        "profile": "None",
    }


@pytest.mark.parametrize(
    "body",
    [
        {"password": NEW_USER_PW, "role": "admin"},
        {"password": NEW_USER_PW * 50},
    ],
)
def test_admin_user_password_validation_error_does_not_echo_it(admin_client, body):
    response = admin_client.post("/api/admin/user-password", json=body)
    assert response.status_code == 422
    assert NEW_USER_PW not in response.text
