"""Authorization matrix for forms (spec §11, bullets 2 to 4)."""

import uuid

import pytest
from sqlalchemy import select

from app.models import Form
from tests.test_forms_common import TITLE, create, created, journal, publish, update, valid_data

WRITES = ["update", "delete"]


def write(client, form: dict, kind: str):
    if kind == "update":
        return update(client, form, valid_data(**{TITLE: "Corrigé"}))
    return client.delete(f"/api/forms/{form['id']}")


def expected_status(kind: str) -> int:
    return 200 if kind == "update" else 204


def stored(db, form: dict) -> Form | None:
    db.expire_all()
    return db.get(Form, uuid.UUID(form["id"]))


@pytest.mark.parametrize("kind", WRITES)
def test_admin_writes_any_profiles_form_owner_unchanged_logged_as_admin(
    kind, db, make_client, admin_client, profile_factory
):
    owner = profile_factory("A", "A")
    form = created(make_client("user", owner), publish(db))
    response = write(admin_client, form, kind)
    assert response.status_code == expected_status(kind), response.text
    if kind == "update":
        assert response.json()["owner"]["id"] == str(owner.id)
        assert stored(db, form).owner_profile_id == owner.id
        assert stored(db, form).data[TITLE] == "Corrigé"
    else:
        assert stored(db, form) is None
    row = journal(db)[-1]
    assert (row.action, row.account_role, row.profile_id) == (f"form_{kind}d", "admin", None)
    assert (row.target_type, row.target_id) == ("form", form["id"])
    assert row.details["reference"] == form["reference"]


def test_admin_gets_403_on_create(db, admin_client):
    response = create(admin_client, publish(db))
    assert response.status_code == 403
    assert db.scalar(select(Form)) is None


@pytest.mark.parametrize("kind", WRITES)
def test_owner_writes_its_own_form(kind, db, make_client, profile_factory):
    owner = profile_factory("A", "A")
    client = make_client("user", owner)
    form = created(client, publish(db))
    assert write(client, form, kind).status_code == expected_status(kind)
    row = journal(db)[-1]
    assert (row.action, row.account_role, row.profile_id) == (f"form_{kind}d", "user", owner.id)


@pytest.mark.parametrize("kind", WRITES)
def test_profile_a_gets_403_on_b_then_succeeds_after_switching(
    kind, db, make_client, profile_factory
):
    a, b = profile_factory("A", "A"), profile_factory("B", "B")
    form = created(make_client("user", b), publish(db))
    client = make_client("user", a)
    response = write(client, form, kind)
    assert response.status_code == 403
    assert response.json()["detail"] == "Cette fiche appartient à un autre profil."
    assert client.post("/api/session/profile", json={"profile_id": str(b.id)}).status_code == 200
    assert write(client, form, kind).status_code == expected_status(kind)
    rows = [(r.action, r.profile_id) for r in journal(db)]
    assert rows[-2:] == [("profile_switch", b.id), (f"form_{kind}d", b.id)]
    if kind == "update":
        assert stored(db, form).owner_profile_id == b.id


@pytest.mark.parametrize("kind", ["create", *WRITES])
def test_write_without_active_profile_is_403(kind, db, make_client, user_client, profile_factory):
    version = publish(db)
    form = created(make_client("user", profile_factory()), version)
    if kind == "create":
        response = create(user_client, version)
    else:
        response = write(user_client, form, kind)
    assert response.status_code == 403
    assert response.json()["detail"] == "Choisissez d'abord un profil."
    assert len(db.scalars(select(Form)).all()) == 1
    assert journal(db)[-1].action == "form_created"
