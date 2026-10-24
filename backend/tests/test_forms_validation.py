"""Form data validated against the bound template version tree (spec §3.2)."""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models import Form, Template
from tests.test_forms_common import (
    AUTHOR,
    CA,
    CB,
    CHECKS,
    COMMENT,
    DATE,
    KO,
    OK,
    RESULT,
    TITLE,
    WHEN,
    create,
    created,
    publish,
    raw,
    uid,
    update,
    valid_data,
)


@pytest.fixture
def profile(profile_factory):
    return profile_factory()


@pytest.fixture
def client(make_client, profile):
    return make_client("user", profile)


def stored_data(db, form: dict) -> dict:
    db.expire_all()
    return db.get(Form, uuid.UUID(form["id"])).data


@pytest.mark.parametrize(
    ("data", "node", "message"),
    [
        ({TITLE: "Lot 1"}, DATE, "« Date » : champ obligatoire."),
        (valid_data(**{TITLE: "   "}), TITLE, "« Titre » : champ obligatoire."),
        (valid_data(**{TITLE: "x" * 11}), TITLE, "« Titre » : 10 caractères au maximum."),
        (valid_data(**{TITLE: 12}), TITLE, "« Titre » : texte attendu."),
        (valid_data(**{RESULT: [OK, KO]}), RESULT, "« Résultat » : une seule option possible."),
        (valid_data(**{RESULT: uid()}), RESULT, "« Résultat » : option inconnue."),
        (valid_data(**{CHECKS: [CA, uid()]}), CHECKS, "« Vérifications » : option inconnue."),
        (valid_data(**{CHECKS: CA}), CHECKS, "« Vérifications » : liste d'options attendue."),
        (valid_data(**{AUTHOR: uid()}), AUTHOR, "« Auteur » : profil inconnu."),
        (valid_data(**{AUTHOR: "moi"}), AUTHOR, "« Auteur » : profil inconnu."),
        (valid_data(**{DATE: "24/10/2026"}), DATE, "« Date » : date invalide"),
        (valid_data(**{RESULT: KO}), COMMENT, "« Écart » : champ obligatoire."),
        (valid_data(**{CHECKS: [CB], WHEN: "demain"}), WHEN, "« Date de péremption » : date"),
    ],
)
def test_invalid_data_is_422_naming_the_field(db, client, data, node, message):
    version = publish(db)
    response = create(client, version, data)
    assert response.status_code == 422, response.text
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "data", node]
    assert error["msg"].startswith(message)
    form = created(client, version)
    assert update(client, form, data).status_code == 422
    assert db.scalar(select(Form.data)) == valid_data()


def test_errors_are_all_reported(db, client):
    response = create(client, publish(db), {TITLE: "x" * 11, RESULT: [OK]})
    assert [e["loc"][-1] for e in response.json()["detail"]] == [DATE, TITLE, RESULT]


def test_valid_data_is_normalized(db, client, profile):
    data = valid_data(
        **{AUTHOR: str(profile.id), RESULT: OK, CHECKS: [CB, CA, CA], WHEN: "2027-01-31"}
    )
    form = created(client, publish(db), data | {"inconnu": "x", AUTHOR + "x": 1})
    assert form["data"] == data | {CHECKS: [CA, CB]}
    assert stored_data(db, form) == form["data"]


EMPTIES = [None, "", []]


@pytest.mark.parametrize("empty", EMPTIES)
def test_empty_values_are_not_stored(db, client, empty):
    version = publish(db)
    data = valid_data(**{RESULT: empty, CHECKS: empty, AUTHOR: empty})
    assert created(client, version, data)["data"] == valid_data()
    data = valid_data(**{CHECKS: [CB], WHEN: empty})  # visible optional date child
    assert created(client, version, data)["data"] == valid_data(**{CHECKS: [CB]})


@pytest.mark.parametrize("empty", EMPTIES)
def test_empty_required_values_are_missing(db, client, empty):
    """Every value node type, required and visible: an empty value is « champ obligatoire »."""
    nodes = [
        {"id": uid(), "type": t, "label": t, "required": True}
        | ({"options": [{"id": uid(), "label": "Oui"}]} if t.endswith("group") else {})
        for t in ("text", "date", "author", "radio_group", "checkbox_group")
    ]
    response = create(client, publish(db, nodes), {n["id"]: empty for n in nodes})
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert [e["loc"][-1] for e in detail] == [n["id"] for n in nodes]
    assert all(e["msg"].endswith("champ obligatoire.") for e in detail)


@pytest.mark.parametrize("bad", ["a\x00b", "a\ud800b", "\udfff"])
@pytest.mark.parametrize(
    ("node", "value", "message"),
    [
        (TITLE, "{}", "caractère non autorisé."),
        (DATE, "{}", "caractère non autorisé."),
        (AUTHOR, "{}", "caractère non autorisé."),
        (RESULT, "{}", "caractère non autorisé."),
        (CHECKS, ["{}"], "option inconnue."),
    ],
)
def test_unstorable_characters_are_422_naming_the_field(db, client, bad, node, value, message):
    """PostgreSQL refuses U+0000 and UTF-8 lone surrogates: 422, never a 500 from the database."""
    value = [v.format(bad) for v in value] if isinstance(value, list) else value.format(bad)
    version = publish(db)
    body = {"template_version_id": str(version.id), "data": valid_data(**{node: value})}
    response = raw(client, "POST", "/api/forms", body)
    assert response.status_code == 422, response.text
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "data", node]
    assert error["msg"].endswith(message)
    form = created(client, version)
    body = {"reference": form["reference"], "data": valid_data(**{node: value})}
    assert raw(client, "PUT", f"/api/forms/{form['id']}", body).status_code == 422
    assert db.scalar(select(Form.data)) == valid_data()


def test_hidden_children_are_stripped_and_not_validated(db, client):
    """KO is not selected: its required child is neither required nor kept, even if invalid;
    CB is not checked: its date child is dropped too."""
    data = valid_data(**{RESULT: OK, COMMENT: 42, CHECKS: [CA], WHEN: "pas une date"})
    form = created(client, publish(db), data)
    assert form["data"] == valid_data(**{RESULT: OK, CHECKS: [CA]})
    assert stored_data(db, form) == form["data"]
    response = update(client, form, valid_data(**{RESULT: KO, COMMENT: "Étiquette abîmée"}))
    assert response.json()["data"][COMMENT] == "Étiquette abîmée"
    unchecked = update(client, form, valid_data(**{RESULT: OK, COMMENT: "Étiquette abîmée"}))
    assert COMMENT not in unchecked.json()["data"]
    assert COMMENT not in stored_data(db, form)


def test_form_stays_bound_to_its_version(db, client):
    v1 = publish(db)
    form = created(client, v1)
    new_title = {"id": uid(), "type": "text", "label": "Nouveau", "required": True}
    v2 = publish(db, [new_title], template=db.get(Template, v1.template_id))
    assert v2.version == 2
    response = update(client, form, valid_data(**{TITLE: "Lot 2"}))
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["template_version_id"], body["version"]) == (str(v1.id), 1)
    assert body["schema_json"] == v1.schema_json
    assert body["data"][TITLE] == "Lot 2"
    assert create(client, v2, {}).status_code == 422


def test_archived_template_or_unknown_version_is_refused(db, client):
    version = publish(db)
    template = db.get(Template, version.template_id)
    template.archived_at = version.published_at
    db.commit()
    response = create(client, version)
    assert (response.status_code, response.json()["detail"]) == (
        422,
        "Ce template n'existe pas ou est archivé.",
    )
    unknown = create(client, SimpleNamespace(id=uuid.uuid4()))
    assert unknown.status_code == 422
