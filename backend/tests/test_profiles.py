"""Profiles API (U4): admin CRUD, delete/archive semantics, active-profile switch, authz."""

import json
import uuid

import pytest
from sqlalchemy import select

from app.models import ActivityLog, Form, Profile, Template, TemplateVersion

GOOD = {"display_name": "Camille D.", "number": 12, "color": "#1a2B3c"}


def actions(db) -> list[str]:
    db.expire_all()
    return list(db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)))


@pytest.fixture
def add_form(db):
    """add_form(profile) inserts a form owned by the profile (the forms API arrives with U7)."""
    template = Template(name="Modèle")
    db.add(template)
    db.flush()
    version = TemplateVersion(template_id=template.id, version=1, schema_json={})
    db.add(version)
    db.flush()

    def add(profile: Profile, data: dict | None = None) -> Form:
        form = Form(
            template_version_id=version.id,
            reference=f"F-{uuid.uuid4().hex[:8]}",
            owner_profile_id=profile.id,
            data=data or {},
        )
        db.add(form)
        db.commit()
        return form

    return add


# --- admin CRUD -------------------------------------------------------------------------------


def test_admin_creates_lists_and_updates(admin_client, db):
    created = admin_client.post("/api/profiles", json=GOOD)
    assert created.status_code == 201
    body = created.json()
    assert (body["display_name"], body["number"], body["color"]) == tuple(GOOD.values())
    assert body["archived_at"] is None

    listed = admin_client.get("/api/profiles").json()
    assert [p["id"] for p in listed] == [body["id"]]

    update = {"display_name": "  Camille Durand ", "number": 13, "color": "#000000"}
    response = admin_client.put(f"/api/profiles/{body['id']}", json=update)
    assert response.status_code == 200
    assert response.json()["display_name"] == "Camille Durand"
    assert actions(db) == ["profile_create", "profile_update"]


def test_admin_list_flags_archived_profiles(admin_client, profile_factory):
    profile_factory("Actif")
    archived = profile_factory("Ancien", archived=True)
    assert [p["display_name"] for p in admin_client.get("/api/profiles").json()] == ["Actif"]
    rows = admin_client.get("/api/profiles?include_archived=true").json()
    assert [p["display_name"] for p in rows] == ["Actif", "Ancien"]
    assert {p["id"]: p["archived_at"] is not None for p in rows}[str(archived.id)]


def test_update_unknown_profile_is_404(admin_client):
    response = admin_client.put(f"/api/profiles/{uuid.uuid4()}", json=GOOD)
    assert (response.status_code, response.json()["detail"]) == (404, "Profil introuvable.")


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("color", "red", "#rrggbb"),
        ("color", "#12345", "#rrggbb"),
        ("color", "#12345g", "#rrggbb"),
        ("color", "#1234567", "#rrggbb"),
        ("number", 0, "nombre entier de 1 à 999"),
        ("number", 1000, "nombre entier de 1 à 999"),
        ("number", -4, "nombre entier de 1 à 999"),
        ("number", "12a", "nombre entier de 1 à 999"),
        ("number", "12", "nombre entier de 1 à 999"),
        ("number", 1.5, "nombre entier de 1 à 999"),
        ("number", True, "nombre entier de 1 à 999"),
        ("number", None, "nombre entier de 1 à 999"),
        ("display_name", "   ", "obligatoire"),
        ("display_name", "x" * 101, "obligatoire"),
    ],
)
def test_invalid_payload_is_422_in_french(admin_client, profile_factory, field, value, message):
    existing = profile_factory()
    body = {**GOOD, field: value}
    for response in (
        admin_client.post("/api/profiles", json=body),
        admin_client.put(f"/api/profiles/{existing.id}", json=body),
    ):
        assert response.status_code == 422
        assert message in response.json()["detail"][0]["msg"]


def test_missing_number_is_422_in_french(admin_client):
    body = {k: v for k, v in GOOD.items() if k != "number"}
    response = admin_client.post("/api/profiles", json=body)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "number"]
    assert "nombre entier de 1 à 999" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("extra", [{"archived_at": None}, {"initials": "CD"}])
def test_unknown_field_is_422(admin_client, extra):
    assert admin_client.post("/api/profiles", json={**GOOD, **extra}).status_code == 422


def test_number_is_an_int_in_every_profile_payload(admin_client, make_client, profile_factory):
    profile = profile_factory("Marie Curie", 7)
    owner_numbers = [
        admin_client.get("/api/profiles").json()[0]["number"],
        make_client("user", profile).get("/api/auth/me").json()["active_profile"]["number"],
    ]
    assert owner_numbers == [7, 7]
    assert all(type(n) is int for n in owner_numbers)


# --- number uniqueness among active profiles ----------------------------------------------------

DUPLICATE = "Le numéro 12 est déjà attribué au profil Camille."


def test_duplicate_active_number_is_409_on_create(admin_client, db):
    first = {**GOOD, "display_name": "Camille"}
    assert admin_client.post("/api/profiles", json=first).status_code == 201
    response = admin_client.post("/api/profiles", json={**GOOD, "display_name": "Autre"})
    assert (response.status_code, response.json()["detail"]) == (409, DUPLICATE)
    assert actions(db) == ["profile_create"]
    assert len(admin_client.get("/api/profiles").json()) == 1


def test_duplicate_active_number_is_409_on_update(admin_client, profile_factory, db):
    holder = profile_factory("Camille", 12)
    other = profile_factory("Autre", 3)
    response = admin_client.put(f"/api/profiles/{other.id}", json=GOOD)
    assert (response.status_code, response.json()["detail"]) == (409, DUPLICATE)
    db.expire_all()
    assert db.get(Profile, other.id).number == 3
    assert actions(db) == []
    # keeping one's own number is not a clash
    assert admin_client.put(f"/api/profiles/{holder.id}", json=GOOD).status_code == 200


def test_archived_profile_keeps_its_number_and_frees_it_for_a_new_one(
    admin_client, profile_factory, add_form, db
):
    old = profile_factory("Ancien", 12)
    add_form(old)
    assert admin_client.delete(f"/api/profiles/{old.id}").json()["archived"] is True
    created = admin_client.post("/api/profiles", json=GOOD)
    assert created.status_code == 201
    db.expire_all()
    assert db.get(Profile, old.id).number == 12
    listed = admin_client.get("/api/profiles?include_archived=true").json()
    assert [p["number"] for p in listed] == [12, 12]


# --- user-facing list -------------------------------------------------------------------------


def test_user_list_returns_only_active_profiles(user_client, profile_factory):
    profile_factory("Actif")
    profile_factory("Ancien", archived=True)
    response = user_client.get("/api/profiles")
    assert response.status_code == 200
    assert [p["display_name"] for p in response.json()] == ["Actif"]
    assert user_client.get("/api/profiles?include_archived=true").status_code == 403


# --- delete semantics -------------------------------------------------------------------------


def test_delete_without_forms_removes_the_profile(admin_client, profile_factory, db):
    profile_id = profile_factory().id
    path = f"/api/profiles/{profile_id}"
    assert admin_client.get(f"{path}/deletion-impact").json() == {
        "forms_count": 0,
        "will_archive": False,
    }
    response = admin_client.delete(path)
    assert response.json() == {"forms_count": 0, "archived": False}
    db.expire_all()
    assert db.get(Profile, profile_id) is None
    assert actions(db) == ["profile_delete"]


def test_delete_with_forms_archives_and_keeps_forms(admin_client, profile_factory, add_form, db):
    profile = profile_factory()
    forms = [add_form(profile), add_form(profile)]
    path = f"/api/profiles/{profile.id}"
    assert admin_client.get(f"{path}/deletion-impact").json() == {
        "forms_count": 2,
        "will_archive": True,
    }
    response = admin_client.delete(path)
    assert response.status_code == 200
    assert response.json() == {"forms_count": 2, "archived": True}
    db.expire_all()
    assert db.get(Profile, profile.id).archived_at is not None
    assert {f.id for f in db.scalars(select(Form))} == {f.id for f in forms}
    assert all(f.owner_profile_id == profile.id for f in db.scalars(select(Form)))
    assert actions(db) == ["profile_archive"]
    # deleting again keeps the first archive date
    first = db.get(Profile, profile.id).archived_at
    assert admin_client.delete(path).json()["archived"] is True
    db.expire_all()
    assert db.get(Profile, profile.id).archived_at == first


def test_profile_named_as_author_in_a_form_is_archived_not_deleted(
    admin_client, profile_factory, add_form, db
):
    owner, author = profile_factory("Alice"), profile_factory("Bruno")
    add_form(owner, {str(uuid.uuid4()): str(author.id)})
    path = f"/api/profiles/{author.id}"
    assert admin_client.get(f"{path}/deletion-impact").json() == {
        "forms_count": 1,
        "will_archive": True,
    }
    assert admin_client.delete(path).json() == {"forms_count": 1, "archived": True}
    db.expire_all()
    assert db.get(Profile, author.id).archived_at is not None
    assert actions(db) == ["profile_archive"]


def test_delete_unknown_profile_is_404(admin_client):
    ghost = uuid.uuid4()
    assert admin_client.delete(f"/api/profiles/{ghost}").status_code == 404
    assert admin_client.get(f"/api/profiles/{ghost}/deletion-impact").status_code == 404


def test_deleting_the_active_profile_clears_it_from_sessions(
    admin_client, make_client, profile_factory
):
    profile = profile_factory()
    user = make_client("user", profile)
    admin_client.delete(f"/api/profiles/{profile.id}")
    assert user.get("/api/auth/me").json()["active_profile"] is None


# --- switching the active profile -------------------------------------------------------------


def test_switch_sets_the_active_profile_and_logs_from_to(make_client, profile_factory, db):
    first, second = profile_factory("A"), profile_factory("B")
    user = make_client("user")
    response = user.post("/api/session/profile", json={"profile_id": str(first.id)})
    assert response.status_code == 200
    assert response.json()["active_profile"]["id"] == str(first.id)
    assert user.get("/api/auth/me").json()["active_profile"]["id"] == str(first.id)
    user.post("/api/session/profile", json={"profile_id": str(second.id)})
    assert user.get("/api/auth/me").json()["active_profile"]["display_name"] == "B"

    rows = db.scalars(select(ActivityLog).order_by(ActivityLog.id)).all()
    assert [r.action for r in rows] == ["profile_switch", "profile_switch"]
    assert [r.profile_id for r in rows] == [first.id, second.id]
    assert (rows[0].account_role, rows[0].details["from"], rows[0].details["to"]) == (
        "user",
        None,
        str(first.id),
    )
    assert (rows[1].details["from"], rows[1].details["to"]) == (str(first.id), str(second.id))


def test_switch_refuses_archived_unknown_and_malformed(make_client, profile_factory, db):
    archived = profile_factory(archived=True)
    user = make_client("user")
    response = user.post("/api/session/profile", json={"profile_id": str(archived.id)})
    assert (response.status_code, "archivé" in response.json()["detail"]) == (409, True)
    response = user.post("/api/session/profile", json={"profile_id": str(uuid.uuid4())})
    assert (response.status_code, response.json()["detail"]) == (404, "Profil introuvable.")
    assert user.post("/api/session/profile", json={"profile_id": "x"}).status_code == 422
    assert user.get("/api/auth/me").json()["active_profile"] is None
    assert actions(db) == []


def test_switch_refuses_admin(admin_client, profile_factory, db):
    profile = profile_factory()
    response = admin_client.post("/api/session/profile", json={"profile_id": str(profile.id)})
    assert response.status_code == 403
    assert admin_client.get("/api/auth/me").json()["active_profile"] is None
    assert actions(db) == []


def test_archiving_the_active_profile_drops_it_from_me(
    admin_client, make_client, profile_factory, add_form
):
    profile = profile_factory()
    add_form(profile)
    user = make_client("user", profile)
    admin_client.delete(f"/api/profiles/{profile.id}")
    assert user.get("/api/auth/me").json()["active_profile"] is None


# --- authorization ----------------------------------------------------------------------------

some = str(uuid.uuid4())
ADMIN_ROUTES = [
    ("POST", "/api/profiles", GOOD),
    ("PUT", f"/api/profiles/{some}", GOOD),
    ("DELETE", f"/api/profiles/{some}", None),
    ("GET", f"/api/profiles/{some}/deletion-impact", None),
]
ALL_ROUTES = [
    *ADMIN_ROUTES,
    ("GET", "/api/profiles", None),
    ("POST", "/api/session/profile", {"profile_id": some}),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
def test_user_gets_403_on_profile_admin_routes(user_client, method, path, body):
    assert user_client.request(method, path, json=body).status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), ALL_ROUTES)
def test_anonymous_gets_401_on_profile_routes(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 401


@pytest.mark.parametrize(("method", "path", "body"), [r for r in ALL_ROUTES if r[0] != "GET"])
def test_writes_without_csrf_token_get_403(make_client, method, path, body):
    no_csrf = make_client("admin")
    del no_csrf.headers["X-CSRF-Token"]
    assert no_csrf.request(method, path, json=body).status_code == 403


def test_failed_writes_leave_no_activity_row(user_client, admin_client, db):
    user_client.post("/api/profiles", json=GOOD)
    admin_client.post("/api/profiles", json={**GOOD, "color": "nope"})
    assert actions(db) == []


@pytest.mark.parametrize("bad", ["a\x00", "\ud800"])
def test_unstorable_characters_in_a_profile_are_422(admin_client, bad):
    # ensure_ascii JSON: httpx's json= cannot encode a lone surrogate.
    response = admin_client.post(
        "/api/profiles",
        content=json.dumps(GOOD | {"display_name": bad}),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422, response.text
