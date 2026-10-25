import json
import uuid

import pytest
from sqlalchemy import select

from app.main import app
from app.models import ActivityLog, Annex, Form, TemplateVersion


def uid() -> str:
    return str(uuid.uuid4())


def tree(label: str = "Note", annex_id: str | None = None) -> dict:
    node = {"id": uid(), "type": "text", "label": label}
    if annex_id:
        node["annex_ref"] = {"annex_id": annex_id}
    return {"nodes": [{"id": uid(), "type": "reference", "label": "Référence"}, node]}


def make_annex(db) -> Annex:
    annex = Annex(title="Notice", filename="notice.pdf", storage_path="x.pdf", size=1, sha256="0")
    db.add(annex)
    db.commit()
    return annex


def create(client, name: str = "Contrôle") -> dict:
    response = client.post("/api/templates", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def publish(client, template_id: str, body: dict | None = None):
    return client.post(f"/api/templates/{template_id}/versions", json=body or tree())


def actions(db) -> list[tuple[str, str | None, dict]]:
    rows = db.scalars(select(ActivityLog).order_by(ActivityLog.id))
    return [(r.action, r.account_role, r.details) for r in rows]


def test_create_template(admin_client, db):
    template = create(admin_client, "  Contrôle  ")
    assert template | {"id": None} == {
        "id": None,
        "name": "Contrôle",
        "archived_at": None,
        "latest_version": None,
    }
    assert admin_client.post("/api/templates", json={"name": " "}).status_code == 422
    assert actions(db)[0][:2] == ("template_created", "admin")


def test_publish_appends_immutable_versions(admin_client, db):
    template = create(admin_client)
    first, second = tree("Première"), tree("Seconde")
    v1 = publish(admin_client, template["id"], first)
    v2 = publish(admin_client, template["id"], second)
    assert (v1.status_code, v2.status_code) == (201, 201)
    assert (v1.json()["version"], v2.json()["version"]) == (1, 2)
    assert v1.json()["schema_json"]["nodes"][1]["label"] == "Première"
    detail = admin_client.get(f"/api/templates/{template['id']}").json()
    assert detail["latest_version"] == 2
    assert [(v["version"], v["schema_json"]["nodes"][1]["label"]) for v in detail["versions"]] == [
        (1, "Première"),
        (2, "Seconde"),
    ]
    assert [a[0] for a in actions(db)] == [
        "template_created",
        "template_published",
        "template_published",
    ]
    assert actions(db)[2][2] == {"name": "Contrôle", "version": 2, "ip": "testclient"}


def test_no_route_updates_a_version():
    paths = app.openapi()["paths"]
    template_ops = {
        (path, method)
        for path, ops in paths.items()
        if path.startswith("/api/templates")
        for method in ops
    }
    assert not {op for op in template_ops if op[1] in ("put", "patch")}
    version_writes = {op for op in template_ops if "/versions" in op[0] and op[1] != "get"}
    assert version_writes == {
        ("/api/templates/{template_id}/versions", "post"),
        ("/api/templates/{template_id}/versions/{version}/restore", "post"),
    }


def test_publish_rejects_an_invalid_tree(admin_client):
    template = create(admin_client)
    bad = tree()
    bad["nodes"][1]["id"] = bad["nodes"][0]["id"]
    response = publish(admin_client, template["id"], bad)
    assert response.status_code == 422
    assert "Identifiant en double" in response.text


def test_publish_checks_annexes(admin_client, db):
    template = create(admin_client)
    annex = make_annex(db)
    assert publish(admin_client, template["id"], tree(annex_id=str(annex.id))).status_code == 201
    missing = uid()
    response = publish(admin_client, template["id"], tree(annex_id=missing))
    assert response.status_code == 422
    assert missing in response.json()["detail"]
    assert admin_client.get(f"/api/templates/{template['id']}").json()["latest_version"] == 1


def test_restore_republishes_an_old_version(admin_client, db):
    template = create(admin_client)
    publish(admin_client, template["id"], tree("Première"))
    publish(admin_client, template["id"], tree("Seconde"))
    response = admin_client.post(f"/api/templates/{template['id']}/versions/1/restore")
    assert response.status_code == 201
    versions = admin_client.get(f"/api/templates/{template['id']}").json()["versions"]
    assert response.json()["version"] == 3
    assert versions[2]["schema_json"] == versions[0]["schema_json"]
    assert versions[2]["id"] != versions[0]["id"]
    assert actions(db)[-1][0] == "template_restored"
    assert actions(db)[-1][2]["restored_from"] == 1
    restore_missing = f"/api/templates/{template['id']}/versions/9/restore"
    assert admin_client.post(restore_missing).status_code == 404


def test_archive_hides_from_the_user_list(admin_client, make_client, profile_factory, db):
    kept, archived, draft = (
        create(admin_client, "A"),
        create(admin_client, "B"),
        create(admin_client, "C"),
    )
    for template in (kept, archived):
        publish(admin_client, template["id"])
        publish(admin_client, template["id"])
    response = admin_client.post(f"/api/templates/{archived['id']}/archive")
    assert response.status_code == 200 and response.json()["archived_at"]
    assert admin_client.post(f"/api/templates/{archived['id']}/archive").status_code == 200
    for client in (make_client("user"), make_client("user", profile_factory()), admin_client):
        listed = client.get("/api/templates/available")
        assert listed.status_code == 200
        assert [(t["name"], t["version"]["version"]) for t in listed.json()] == [("A", 2)]
    everything = admin_client.get("/api/templates").json()
    assert [(t["name"], bool(t["archived_at"]), t["latest_version"]) for t in everything] == [
        ("A", False, 2),
        ("B", True, 2),
        ("C", False, None),
    ]
    assert [a[0] for a in actions(db)].count("template_archived") == 1
    assert draft["latest_version"] is None


def test_delete_refused_while_a_form_uses_any_version(admin_client, profile_factory, db):
    template = create(admin_client)
    v1 = publish(admin_client, template["id"]).json()
    publish(admin_client, template["id"])
    form = Form(
        template_version_id=v1["id"],
        reference="03-2026-001",
        owner_profile_id=profile_factory().id,
    )
    db.add(form)
    db.commit()
    response = admin_client.delete(f"/api/templates/{template['id']}")
    assert response.status_code == 409
    assert "archivez-le" in response.json()["detail"]
    assert admin_client.get(f"/api/templates/{template['id']}").status_code == 200
    assert "template_deleted" not in [a[0] for a in actions(db)]

    db.delete(form)
    db.commit()
    assert admin_client.delete(f"/api/templates/{template['id']}").status_code == 204
    assert admin_client.get(f"/api/templates/{template['id']}").status_code == 404
    db.expire_all()
    assert db.scalars(select(TemplateVersion)).all() == []
    assert actions(db)[-1][:2] == ("template_deleted", "admin")
    assert admin_client.delete(f"/api/templates/{template['id']}").status_code == 404


def test_unknown_template_is_404(admin_client):
    missing = uid()
    assert admin_client.get(f"/api/templates/{missing}").status_code == 404
    assert publish(admin_client, missing).status_code == 404


# --- authorization ----------------------------------------------------------------------------

WRITES = [
    ("POST", "/api/templates", {"name": "X"}),
    ("POST", "/api/templates/{id}/versions", None),
    ("POST", "/api/templates/{id}/versions/1/restore", None),
    ("POST", "/api/templates/{id}/archive", None),
    ("DELETE", "/api/templates/{id}", None),
]
ADMIN_READS = ["/api/templates", "/api/templates/{id}"]


def test_writes_list_covers_every_template_write_route():
    openapi = {
        (method.upper(), path)
        for path, ops in app.openapi()["paths"].items()
        if path.startswith("/api/templates")
        for method in ops
        if method != "get"
    }
    listed = {
        (m, p.replace("{id}", "{template_id}").replace("/1/", "/{version}/")) for m, p, _ in WRITES
    }
    assert listed == openapi


@pytest.fixture
def published(admin_client):
    template = create(admin_client)
    publish(admin_client, template["id"])
    return template["id"]


@pytest.mark.parametrize("with_profile", [False, True])
@pytest.mark.parametrize(("method", "path", "body"), WRITES)
def test_user_gets_403_on_template_writes(
    make_client, profile_factory, published, db, with_profile, method, path, body
):
    client = make_client("user", profile_factory() if with_profile else None)
    response = client.request(method, path.format(id=published), json=body or tree())
    assert response.status_code == 403
    assert len(actions(db)) == 2  # create + publish only


@pytest.mark.parametrize("path", ADMIN_READS)
def test_user_gets_403_on_admin_reads(user_client, published, path):
    assert user_client.get(path.format(id=published)).status_code == 403


@pytest.mark.parametrize(("method", "path", "body"), WRITES)
def test_anonymous_gets_401(client, published, method, path, body):
    assert client.request(method, path.format(id=published), json=body).status_code == 401
    assert client.get("/api/templates/available").status_code == 401


@pytest.mark.parametrize("bad", ["a\x00b", "a\ud800b"])
def test_unstorable_characters_in_template_text_are_422(admin_client, bad):
    # ensure_ascii JSON: httpx's json= cannot encode a lone surrogate.
    def send(url, body):
        return admin_client.post(
            url, content=json.dumps(body), headers={"content-type": "application/json"}
        )

    assert send("/api/templates", {"name": bad}).status_code == 422
    template = create(admin_client)
    for field in ("label", "help"):
        body = tree()
        body["nodes"][1][field] = bad
        response = send(f"/api/templates/{template['id']}/versions", body)
        assert response.status_code == 422, (field, response.text)
