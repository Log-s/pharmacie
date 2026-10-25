"""Forms list, search, get, can_edit and archived owners (spec §3.1, §2.2)."""

import uuid

import pytest

from tests.test_forms_common import AUTHOR, DATE, TITLE, created, publish, update, valid_data


@pytest.fixture
def world(db, make_client, profile_factory):
    """Profiles A and B, templates Contrôle and Inventaire, forms f1 (A), f2 (A), f3 (B)."""
    a, b = profile_factory("Alice", "AL"), profile_factory("Bruno", "BR", "#16a34a")
    controle, inventaire = publish(db, name="Contrôle"), publish(db, name="Inventaire")
    ca, cb = make_client("user", a), make_client("user", b)

    def data(day: str, title: str, author=None) -> dict:
        return valid_data(
            **{DATE: day, TITLE: title} | ({AUTHOR: str(author.id)} if author else {})
        )

    f1 = created(ca, controle, data("2026-10-01", "Lot alpha", b))
    f2 = created(ca, inventaire, data("2026-10-15", "Lot beta"))
    f3 = created(cb, controle, data("2026-11-02", "Lot gamma", a), reference="03-2026-500")
    return dict(a=a, b=b, ca=ca, cb=cb, controle=controle, inventaire=inventaire, f=[f1, f2, f3])


def refs(client, **params) -> list[str]:
    response = client.get("/api/forms", params=params)
    assert response.status_code == 200, response.text
    return [item["reference"] for item in response.json()["items"]]


def test_search_and_filters(world, admin_client):
    f1, f2, f3 = (f["reference"] for f in world["f"])
    a, b = world["a"].id, world["b"].id
    cases = [
        ({}, [f3, f2, f1]),  # newest first
        ({"q": "alpha"}, [f1]),
        ({"q": "LOT"}, [f3, f2, f1]),
        ({"q": "2026-500"}, [f3]),
        ({"q": "%"}, []),
        ({"reference": "-500"}, [f3]),
        ({"date_from": "2026-10-10"}, [f3, f2]),
        ({"date_to": "2026-10-31"}, [f2, f1]),
        ({"date_from": "2026-10-10", "date_to": "2026-10-31"}, [f2]),
        ({"author_id": str(b)}, [f1]),
        ({"author_id": str(a)}, [f3]),
        ({"owner_profile_id": str(a)}, [f2, f1]),
        ({"template_id": str(world["inventaire"].template_id)}, [f2]),
        ({"template_id": str(world["controle"].template_id), "q": "gamma"}, [f3]),
    ]
    for params, expected in cases:
        assert refs(world["ca"], **params) == expected, params
        assert refs(admin_client, **params) == expected, params


def test_pagination_reports_the_total(world):
    client = world["ca"]
    page1 = client.get("/api/forms", params={"page_size": 2}).json()
    page2 = client.get("/api/forms", params={"page_size": 2, "page": 2}).json()
    assert (page1["total"], page1["page"], page1["page_size"], len(page1["items"])) == (3, 1, 2, 2)
    assert (page2["total"], len(page2["items"])) == (3, 1)
    assert client.get("/api/forms", params={"page": 0}).status_code == 422
    assert client.get("/api/forms", params={"page_size": 101}).status_code == 422
    assert client.get("/api/forms", params={"page": 100_000}).json()["items"] == []
    for page in (100_001, 2**62, 10**18, 10**30):
        assert client.get("/api/forms", params={"page": page}).status_code == 422, page


@pytest.mark.parametrize("param", ["q", "reference"])
def test_unstorable_characters_in_text_filters_are_422(world, param):
    """PostgreSQL refuses U+0000: 422 naming the parameter, never a 500 from the database."""
    response = world["ca"].get("/api/forms", params={param: "Lot\x00"})
    assert response.status_code == 422, response.text
    [error] = response.json()["detail"]
    assert (error["loc"], error["msg"]) == (["query", param], "Caractère non autorisé.")
    # A percent-encoded surrogate is not UTF-8: the server decodes it to U+FFFD, a plain search.
    assert world["ca"].get(f"/api/forms?{param}=%ED%A0%80").json()["total"] == 0


def test_get_is_readable_by_everyone_with_can_edit_for_the_caller(world, admin_client, user_client):
    f1, _f2, f3 = world["f"]
    expected = {
        "admin": (admin_client, True, True),
        "A": (world["ca"], True, False),
        "B": (world["cb"], False, True),
        "no profile": (user_client, False, False),
    }
    for who, (client, f1_edit, f3_edit) in expected.items():
        got = [client.get(f"/api/forms/{f['id']}") for f in (f1, f3)]
        assert [r.status_code for r in got] == [200, 200], who
        assert [r.json()["can_edit"] for r in got] == [f1_edit, f3_edit], who
        listed = {i["id"]: i["can_edit"] for i in client.get("/api/forms").json()["items"]}
        assert (listed[f1["id"]], listed[f3["id"]]) == (f1_edit, f3_edit), who
    detail = admin_client.get(f"/api/forms/{f3['id']}").json()
    assert detail["owner"] == {
        "id": str(world["b"].id),
        "display_name": "Bruno",
        "initials": "BR",
        "color": "#16a34a",
        "archived": False,
    }
    assert (detail["template_name"], detail["version"]) == ("Contrôle", 1)
    assert detail["template_version_id"] == str(world["controle"].id)
    assert detail["schema_json"] == world["controle"].schema_json
    assert detail["data"][TITLE] == "Lot gamma"
    assert admin_client.get(f"/api/forms/{uuid.uuid4()}").status_code == 404


def test_archived_owner_forms_are_read_only_for_the_user(world, admin_client):
    f1 = world["f"][0]
    response = admin_client.delete(f"/api/profiles/{world['a'].id}")
    # A's two forms, plus a third form that names Alice in its author field.
    assert response.json() == {"forms_count": 3, "archived": True}
    for client in (world["ca"], world["cb"]):  # A's stale session, and another profile
        detail = client.get(f"/api/forms/{f1['id']}").json()
        assert (detail["can_edit"], detail["owner"]["archived"]) == (False, True)
        assert detail["owner"]["display_name"] == "Alice"
        assert update(client, f1).status_code == 403
        assert client.delete(f"/api/forms/{f1['id']}").status_code == 403
    assert admin_client.get(f"/api/forms/{f1['id']}").json()["can_edit"] is True
    response = update(admin_client, f1, valid_data(**{TITLE: "Admin"}))
    assert response.status_code == 200
    assert response.json()["owner"]["id"] == str(world["a"].id)
    assert admin_client.delete(f"/api/forms/{f1['id']}").status_code == 204


def test_field_filters_use_the_forms_own_version(world, db):
    """DATE is a date node in Contrôle but a text node here: filters follow each form's tree."""
    note = publish(db, [{"id": DATE, "type": "text", "label": "Note"}], name="Note")
    other = created(world["ca"], note, {DATE: "2026-10-12"})["reference"]
    f2 = world["f"][1]["reference"]
    assert refs(world["ca"], date_from="2026-10-10", date_to="2026-10-31") == [f2]
    assert refs(world["ca"], q="2026-10-12") == [other]
