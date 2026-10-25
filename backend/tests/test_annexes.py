"""Annex notes and folders: CRUD per role, sanitising, cycles, recursive delete, search, journal."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import ActivityLog, Annex, AnnexFolder, Template, TemplateVersion
from app.services import annexes


def make_folder(client, name="Protocoles", parent_id=None) -> dict:
    response = client.post("/api/annex-folders", json={"name": name, "parent_id": parent_id})
    assert response.status_code == 201, response.text
    return response.json()


def make_note(client, title="Notice", body_html="<p>Dosage</p>", folder_id=None) -> dict:
    body = {"title": title, "body_html": body_html, "folder_id": folder_id}
    response = client.post("/api/annexes", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def actions(db) -> list[str]:
    return list(db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)))


def add_template(db, name, *schemas, archived=False):
    """One template with one version per schema (version 1..n)."""
    template = Template(name=name, archived_at=datetime.now(UTC) if archived else None)
    db.add(template)
    db.flush()
    for number, schema in enumerate(schemas, 1):
        db.add(TemplateVersion(template_id=template.id, version=number, schema_json=schema))
    db.commit()


def ref(annex_id) -> dict:
    return {
        "categories": [
            {"fields": [{"label": "x", "children": [{"annex_ref": {"annex_id": str(annex_id)}}]}]}
        ]
    }


# --- notes: CRUD ------------------------------------------------------------------------------


def test_create_read_and_edit_a_note(admin_client, user_client, db):
    folder = make_folder(admin_client)
    note = make_note(
        admin_client, " Notice ", "<p>Posologie   <strong>adulte</strong></p>", folder["id"]
    )
    assert note["title"] == "Notice"
    assert note["folder_id"] == folder["id"]
    assert note["body_html"] == "<p>Posologie   <strong>adulte</strong></p>"
    assert note["excerpt"] == "Posologie adulte"
    for client in (admin_client, user_client):
        assert client.get(f"/api/annexes/{note['id']}").json() == note
    response = admin_client.patch(
        f"/api/annexes/{note['id']}", json={"title": "Nouveau", "body_html": "<h1>Titre</h1>"}
    )
    assert response.status_code == 200
    assert (response.json()["title"], response.json()["excerpt"]) == ("Nouveau", "Titre")
    assert response.json()["folder_id"] == folder["id"]  # untouched when not sent
    assert response.json()["updated_at"] >= note["updated_at"]
    assert actions(db) == ["annex_folder_created", "annex_created", "annex_updated"]


def test_note_defaults_to_the_root_and_can_move_back_there(admin_client):
    folder = make_folder(admin_client)
    note = make_note(admin_client)
    assert note["folder_id"] is None
    moved = admin_client.patch(f"/api/annexes/{note['id']}", json={"folder_id": folder["id"]})
    assert moved.json()["folder_id"] == folder["id"]
    back = admin_client.patch(f"/api/annexes/{note['id']}", json={"folder_id": None})
    assert back.json()["folder_id"] is None


def test_excerpt_is_the_first_300_characters_of_the_text(admin_client):
    note = make_note(admin_client, body_html="<p>" + "mot " * 200 + "</p>")
    assert len(note["excerpt"]) == 300


def test_unknown_folder_is_a_404_on_create_and_move(admin_client, db):
    missing = str(uuid.uuid4())
    response = admin_client.post("/api/annexes", json={"title": "x", "folder_id": missing})
    assert response.status_code == 404
    assert "Dossier" in response.json()["detail"]
    note = make_note(admin_client)
    patch = admin_client.patch(f"/api/annexes/{note['id']}", json={"folder_id": missing})
    assert patch.status_code == 404
    assert db.scalar(select(Annex.folder_id)) is None
    assert actions(db) == ["annex_created"]


def test_unknown_note_is_a_404(admin_client, user_client):
    missing = uuid.uuid4()
    assert user_client.get(f"/api/annexes/{missing}").status_code == 404
    assert admin_client.patch(f"/api/annexes/{missing}", json={"title": "x"}).status_code == 404
    assert admin_client.delete(f"/api/annexes/{missing}").status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "x" * 201},
        {"title": "a\u0000b"},
        {"title": "ok", "body_html": "a\u0000b"},
        {"title": "ok", "body_html": "x" * 200_001},
    ],
)
def test_invalid_note_is_rejected_and_nothing_is_stored(admin_client, db, body):
    assert admin_client.post("/api/annexes", json=body).status_code == 422
    assert db.scalar(select(Annex)) is None
    assert actions(db) == []


def test_body_html_limit_is_200_000_characters(admin_client):
    ok = make_note(admin_client, body_html="<p>" + "a" * 199_990 + "</p>")  # 199 997 characters
    assert ok["excerpt"] == "a" * 300
    patch = admin_client.patch(f"/api/annexes/{ok['id']}", json={"body_html": "x" * 200_001})
    assert patch.status_code == 422


@pytest.mark.parametrize("body", [{"title": ""}, {"filename": "a.pdf"}, {"body_text": "x"}])
def test_invalid_note_edits_are_rejected(admin_client, body):
    note = make_note(admin_client)
    assert admin_client.patch(f"/api/annexes/{note['id']}", json=body).status_code == 422


# --- sanitising (every write path) ------------------------------------------------------------

DIRTY = (
    '<p onclick="steal()" class="x">a <script>alert(1)</script><style>p{}</style> '
    '<u>souligné</u> <a href="javascript:alert(1)">mauvais</a> '
    '<a href="https://example.org" target="_blank" onmouseover="x()">bon</a> '
    '<img src="x" onerror="y()"><iframe src="https://evil"></iframe><h4>quatre</h4> '
    "<div>bloc</div></p>"
)


def written_both_ways(admin_client, db):
    """The note as stored after a POST of DIRTY and after a PATCH of DIRTY on another note."""
    posted = make_note(admin_client, body_html=DIRTY)
    other = make_note(admin_client, title="Autre")
    patched = admin_client.patch(f"/api/annexes/{other['id']}", json={"body_html": DIRTY}).json()
    stored = [db.get(Annex, uuid.UUID(n["id"])) for n in (posted, patched)]
    return [(n, row) for n, row in zip((posted, patched), stored, strict=True)]


def test_script_tag_and_its_content_are_removed(admin_client, db):
    for note, row in written_both_ways(admin_client, db):
        for text in (note["body_html"], row.body_html, row.body_text):
            assert "script" not in text and "alert" not in text
            assert "<style" not in text and "p{}" not in text


def test_event_handler_attributes_are_removed(admin_client, db):
    for note, row in written_both_ways(admin_client, db):
        for html in (note["body_html"], row.body_html):
            for attribute in ("onclick", "onmouseover", "onerror", "class=", "target="):
                assert attribute not in html


def test_javascript_links_are_removed_and_other_links_get_rel(admin_client, db):
    for note, row in written_both_ways(admin_client, db):
        for html in (note["body_html"], row.body_html):
            assert "javascript" not in html
            assert '<a href="https://example.org" rel="noopener noreferrer">bon</a>' in html
            assert html.count("<a ") == html.count('rel="noopener noreferrer"') == 2


def test_mailto_is_kept_and_other_schemes_are_dropped(admin_client):
    body = '<a href="mailto:a@b.fr">m</a><a href="ftp://x">f</a><a href="data:text/html,x">d</a>'
    html = make_note(admin_client, body_html=body)["body_html"]
    assert 'href="mailto:a@b.fr"' in html
    assert "ftp:" not in html and "data:" not in html


def test_underline_and_the_editor_tags_are_kept(admin_client, db):
    body = (
        "<h1>a</h1><h2>b</h2><h3>c</h3><p><strong>g</strong><em>i</em><u>u</u><s>s</s><br>"
        "<code>c</code></p><ul><li>x</li></ul><ol><li>y</li></ol><blockquote>q</blockquote>"
        "<pre>p</pre><hr>"
    )
    for note, row in written_both_ways(admin_client, db):
        assert "<u>souligné</u>" in note["body_html"] == row.body_html
    assert make_note(admin_client, body_html=body)["body_html"] == body


def test_other_tags_are_stripped_but_their_text_survives(admin_client, db):
    for note, row in written_both_ways(admin_client, db):
        for html in (note["body_html"], row.body_html):
            for tag in ("<img", "<iframe", "<h4", "<div"):
                assert tag not in html
            assert "quatre" in html and "bloc" in html


def test_body_text_is_plain_normalised_text(admin_client, db):
    body = (
        "<h1>Titre</h1><p>Un  <strong>mot</strong>\n  &amp; <em>deux</em></p>"
        "<ul><li>a</li><li>b</li></ul>"
    )
    note = make_note(admin_client, body_html=body)
    row = db.get(Annex, uuid.UUID(note["id"]))
    assert row.body_text == "Titre Un mot & deux a b"
    assert annexes.sanitize("<p>a</p><p>b<br>c</p>")[1] == "a b c"
    for _note, row in written_both_ways(admin_client, db):
        assert row.body_text == "a souligné mauvais bon quatre bloc"


# --- search -----------------------------------------------------------------------------------


def test_list_and_search_on_title_or_body_text_for_both_roles(admin_client, user_client):
    make_note(admin_client, "Guide Warfarine", "<p>Interactions médicamenteuses</p>")
    make_note(admin_client, "Insuline", "<p>Conservation au <strong>frais</strong></p>")
    for client in (admin_client, user_client):
        titles = [n["title"] for n in client.get("/api/annexes").json()]
        assert titles == ["Guide Warfarine", "Insuline"]
        assert [n["title"] for n in client.get("/api/annexes?q=warfARINE").json()] == [
            "Guide Warfarine"
        ]
        assert [n["title"] for n in client.get("/api/annexes?q=CONSERVATION").json()] == [
            "Insuline"
        ]
        assert client.get("/api/annexes?q=strong").json() == []  # markup is not searched
        assert client.get("/api/annexes?q=introuvable").json() == []
        assert len(client.get("/api/annexes?q=%25").json()) == 0  # LIKE wildcards are literal
        assert len(client.get("/api/annexes?q=%20").json()) == 2
        assert set(client.get("/api/annexes").json()[0]) == {
            "id",
            "title",
            "folder_id",
            "excerpt",
            "updated_at",
        }


def test_search_with_nul_is_a_422(admin_client, user_client):
    for client in (admin_client, user_client):
        assert client.get("/api/annexes", params={"q": "a\x00b"}).status_code == 422


# --- tree -------------------------------------------------------------------------------------


def test_tree_lists_folders_and_notes_flat_for_both_roles(admin_client, user_client):
    root = make_folder(admin_client, "Racine")
    child = make_folder(admin_client, "Enfant", root["id"])
    note = make_note(admin_client, "Note", "<p>Texte</p>", child["id"])
    loose = make_note(admin_client, "A la racine", "")
    for client in (admin_client, user_client):
        tree = client.get("/api/annexes/tree").json()
        assert set(tree) == {"folders", "notes"}
        assert tree["folders"] == [
            {"id": child["id"], "name": "Enfant", "parent_id": root["id"]},
            {"id": root["id"], "name": "Racine", "parent_id": None},
        ]
        assert [(n["id"], n["folder_id"], n["excerpt"]) for n in tree["notes"]] == [
            (loose["id"], None, ""),
            (note["id"], child["id"], "Texte"),
        ]
        assert set(tree["notes"][0]) == {"id", "title", "folder_id", "excerpt", "updated_at"}


def test_tree_is_declared_before_the_note_id_route():
    from app.api.annexes import router

    paths = [route.path for route in router.routes]
    assert paths.index("/annexes/tree") < paths.index("/annexes/{annex_id}")


# --- folders: CRUD and cycles -----------------------------------------------------------------


def test_folder_create_rename_and_move(admin_client, db):
    a, b = make_folder(admin_client, "A"), make_folder(admin_client, "B")
    sub = make_folder(admin_client, " Sous ", a["id"])
    assert sub["name"] == "Sous"
    assert sub["parent_id"] == a["id"]
    renamed = admin_client.patch(f"/api/annex-folders/{sub['id']}", json={"name": "Renommé"})
    assert (renamed.json()["name"], renamed.json()["parent_id"]) == ("Renommé", a["id"])
    moved = admin_client.patch(f"/api/annex-folders/{sub['id']}", json={"parent_id": b["id"]})
    assert moved.json()["parent_id"] == b["id"]
    root = admin_client.patch(f"/api/annex-folders/{sub['id']}", json={"parent_id": None})
    assert root.json()["parent_id"] is None
    assert actions(db) == ["annex_folder_created"] * 3 + ["annex_folder_updated"] * 3


def test_unknown_folder_or_parent_is_a_404(admin_client):
    missing = str(uuid.uuid4())
    folder = make_folder(admin_client)
    assert (
        admin_client.post(
            "/api/annex-folders", json={"name": "x", "parent_id": missing}
        ).status_code
        == 404
    )
    assert (
        admin_client.patch(f"/api/annex-folders/{missing}", json={"name": "x"}).status_code == 404
    )
    assert (
        admin_client.patch(
            f"/api/annex-folders/{folder['id']}", json={"parent_id": missing}
        ).status_code
        == 404
    )
    assert admin_client.delete(f"/api/annex-folders/{missing}").status_code == 404


@pytest.mark.parametrize("body", [{"name": ""}, {"name": "x" * 201}, {"name": "a\u0000b"}])
def test_invalid_folder_name_is_rejected(admin_client, db, body):
    assert admin_client.post("/api/annex-folders", json=body).status_code == 422
    folder = make_folder(admin_client)
    assert admin_client.patch(f"/api/annex-folders/{folder['id']}", json=body).status_code == 422
    assert db.scalar(select(AnnexFolder.name)) == "Protocoles"


def chain(admin_client) -> list[dict]:
    """a > b > c, plus an unrelated d."""
    a = make_folder(admin_client, "a")
    b = make_folder(admin_client, "b", a["id"])
    c = make_folder(admin_client, "c", b["id"])
    return [a, b, c, make_folder(admin_client, "d")]


def test_moving_a_folder_into_itself_or_a_descendant_is_a_422(admin_client, db):
    a, b, c, _ = chain(admin_client)
    for target in (a, b, c):  # a under a, b, c; b under b, c; c under c
        response = admin_client.patch(
            f"/api/annex-folders/{a['id']}", json={"parent_id": target["id"]}
        )
        assert response.status_code == 422, target["name"]
        assert "sous-dossier" in response.json()["detail"]
    assert (
        admin_client.patch(f"/api/annex-folders/{b['id']}", json={"parent_id": c["id"]}).status_code
        == 422
    )
    assert (
        admin_client.patch(f"/api/annex-folders/{c['id']}", json={"parent_id": c["id"]}).status_code
        == 422
    )
    parents = {f.name: f.parent_id for f in db.scalars(select(AnnexFolder))}
    assert parents == {"a": None, "b": uuid.UUID(a["id"]), "c": uuid.UUID(b["id"]), "d": None}
    assert "annex_folder_updated" not in actions(db)


def test_a_valid_move_succeeds_and_cycle_helpers_agree(admin_client, db):
    a, b, c, d = chain(admin_client)
    ids = {n: uuid.UUID(f["id"]) for n, f in zip("abcd", (a, b, c, d), strict=True)}
    assert annexes.descendants(db, ids["a"]) == {ids["b"], ids["c"]}
    assert annexes.descendants(db, ids["c"]) == set()
    assert annexes.would_cycle(db, ids["a"], ids["c"])
    assert annexes.would_cycle(db, ids["a"], ids["a"])
    assert not annexes.would_cycle(db, ids["a"], ids["d"])
    assert not annexes.would_cycle(db, ids["c"], ids["a"])
    assert not annexes.would_cycle(db, ids["a"], None)
    # a whole subtree moves under d; c (a descendant of b) goes up to the root
    assert (
        admin_client.patch(f"/api/annex-folders/{a['id']}", json={"parent_id": d["id"]}).status_code
        == 200
    )
    assert (
        admin_client.patch(f"/api/annex-folders/{c['id']}", json={"parent_id": None}).status_code
        == 200
    )
    assert annexes.descendants(db, ids["d"]) == {ids["a"], ids["b"]}


# --- delete -----------------------------------------------------------------------------------


def test_delete_of_a_note_is_refused_while_the_latest_version_references_it(admin_client, db):
    note = make_note(admin_client)
    add_template(db, "Zèbre", ref(note["id"]))
    add_template(db, "Alpha", {"categories": []}, ref(note["id"]))
    add_template(db, "Archivé", ref(note["id"]), archived=True)
    add_template(db, "Autre", ref(uuid.uuid4()))
    response = admin_client.delete(f"/api/annexes/{note['id']}")
    assert response.status_code == 409
    assert response.json()["templates"] == ["Alpha", "Archivé", "Zèbre"]
    assert "Alpha, Archivé, Zèbre" in response.json()["detail"]
    assert db.get(Annex, uuid.UUID(note["id"])) is not None
    assert actions(db) == ["annex_created"]


def test_delete_of_a_note_is_allowed_when_only_an_older_version_references_it(admin_client, db):
    note = make_note(admin_client)
    add_template(db, "Ancien", ref(note["id"]), {"categories": []})
    assert admin_client.delete(f"/api/annexes/{note['id']}").status_code == 204
    assert db.get(Annex, uuid.UUID(note["id"])) is None
    assert admin_client.get(f"/api/annexes/{note['id']}").status_code == 404
    assert actions(db) == ["annex_created", "annex_deleted"]


def test_deleting_a_folder_deletes_its_whole_subtree(admin_client, db):
    a, b, _, d = chain(admin_client)
    make_note(admin_client, "dans a", folder_id=a["id"])
    make_note(admin_client, "dans b", folder_id=b["id"])
    keep = make_note(admin_client, "dans d", folder_id=d["id"])
    response = admin_client.delete(f"/api/annex-folders/{a['id']}")
    assert response.status_code == 204
    db.expire_all()
    assert [f.name for f in db.scalars(select(AnnexFolder))] == ["d"]
    assert [str(n.id) for n in db.scalars(select(Annex))] == [keep["id"]]
    assert actions(db)[-1] == "annex_folder_deleted"
    row = db.scalars(select(ActivityLog).order_by(ActivityLog.id.desc())).first()
    assert (row.details["name"], row.details["notes"], row.details["subfolders"]) == ("a", 2, 2)


def test_folder_delete_is_refused_when_a_note_of_the_subtree_is_referenced(admin_client, db):
    a, b, c, _ = chain(admin_client)
    make_note(admin_client, "libre", folder_id=a["id"])
    used = make_note(admin_client, "utilisée", folder_id=c["id"])
    add_template(db, "Zèbre", ref(used["id"]))
    add_template(db, "Alpha", ref(used["id"]))
    response = admin_client.delete(f"/api/annex-folders/{a['id']}")
    assert response.status_code == 409
    assert response.json()["templates"] == ["Alpha", "Zèbre"]
    assert "Alpha, Zèbre" in response.json()["detail"]
    db.expire_all()
    assert len(db.scalars(select(AnnexFolder)).all()) == 4
    assert len(db.scalars(select(Annex)).all()) == 2
    assert "annex_folder_deleted" not in actions(db)
    # deleting a sibling subtree is unaffected
    assert admin_client.delete(f"/api/annex-folders/{c['id']}").status_code == 409
    assert admin_client.delete(f"/api/annex-folders/{b['id']}").status_code == 409


def test_folder_delete_ignores_templates_whose_old_version_only_references_a_note(admin_client, db):
    folder = make_folder(admin_client)
    note = make_note(admin_client, folder_id=folder["id"])
    add_template(db, "Ancien", ref(note["id"]), {"categories": []})
    assert admin_client.delete(f"/api/annex-folders/{folder['id']}").status_code == 204
    assert db.scalar(select(Annex)) is None


# --- authz ------------------------------------------------------------------------------------


def test_user_can_read_but_not_write(admin_client, user_client, db):
    folder = make_folder(admin_client)
    note = make_note(admin_client, folder_id=folder["id"])
    assert user_client.get("/api/annexes").status_code == 200
    assert user_client.get("/api/annexes/tree").status_code == 200
    assert user_client.get(f"/api/annexes/{note['id']}").status_code == 200
    n, f = f"/api/annexes/{note['id']}", f"/api/annex-folders/{folder['id']}"
    assert user_client.post("/api/annexes", json={"title": "x"}).status_code == 403
    assert user_client.patch(n, json={"title": "x"}).status_code == 403
    assert user_client.delete(n).status_code == 403
    assert user_client.post("/api/annex-folders", json={"name": "x"}).status_code == 403
    assert user_client.patch(f, json={"name": "x"}).status_code == 403
    assert user_client.delete(f).status_code == 403
    assert (db.scalar(select(Annex.title)), db.scalar(select(AnnexFolder.name))) == (
        "Notice",
        "Protocoles",
    )
    assert actions(db) == ["annex_folder_created", "annex_created"]


def test_user_with_an_active_profile_reads_too(make_client, admin_client, profile_factory):
    make_note(admin_client)
    client = make_client("user", profile_factory())
    assert len(client.get("/api/annexes").json()) == 1
    assert len(client.get("/api/annexes/tree").json()["notes"]) == 1


def test_anonymous_gets_401_everywhere(client, admin_client):
    folder, note = make_folder(admin_client), make_note(admin_client)
    n, f = f"/api/annexes/{note['id']}", f"/api/annex-folders/{folder['id']}"
    assert client.get("/api/annexes").status_code == 401
    assert client.get("/api/annexes/tree").status_code == 401
    assert client.get(n).status_code == 401
    assert client.post("/api/annexes", json={"title": "x"}).status_code == 401
    assert client.patch(n, json={"title": "x"}).status_code == 401
    assert client.delete(n).status_code == 401
    assert client.post("/api/annex-folders", json={"name": "x"}).status_code == 401
    assert client.patch(f, json={"name": "x"}).status_code == 401
    assert client.delete(f).status_code == 401


def test_admin_writes_need_the_csrf_token(admin_client):
    folder, note = make_folder(admin_client), make_note(admin_client)
    del admin_client.headers["X-CSRF-Token"]
    n, f = f"/api/annexes/{note['id']}", f"/api/annex-folders/{folder['id']}"
    assert admin_client.post("/api/annexes", json={"title": "x"}).status_code == 403
    assert admin_client.patch(n, json={"title": "x"}).status_code == 403
    assert admin_client.delete(n).status_code == 403
    assert admin_client.post("/api/annex-folders", json={"name": "x"}).status_code == 403
    assert admin_client.patch(f, json={"name": "x"}).status_code == 403
    assert admin_client.delete(f).status_code == 403


# --- helpers kept for the PDF export ----------------------------------------------------------


def test_content_disposition_is_safe_for_non_ascii_and_quotes():
    assert annexes.content_disposition('Fiche "été".pdf') == (
        "inline; filename=\"Fiche __t__.pdf\"; filename*=UTF-8''Fiche%20%22%C3%A9t%C3%A9%22.pdf"
    )
