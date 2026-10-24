"""Annexes (spec §4): upload, excerpt, download, search, edit, delete guard, authz."""

import hashlib
import io
import re
import uuid
from datetime import UTC, datetime

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import select

from app.models import ActivityLog, Annex, Template, TemplateVersion
from app.settings import settings


def make_pdf(text: str | None = None) -> bytes:
    """Tiny one-page PDF; with `text`, drawn through a minimal content stream (Helvetica)."""
    writer = PdfWriter()
    page = writer.add_blank_page(200, 200)
    if text is not None:
        font = writer._add_object(
            DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/Helvetica"),
                }
            )
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 10 100 Td ({text}) Tj ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture(autouse=True)
def annexes_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "annexes_dir", tmp_path / "annexes")
    return settings.annexes_dir


def upload(client, content: bytes, name="notice.pdf", **form):
    files = {"file": (name, content, "application/pdf")}
    return client.post("/api/annexes", files=files, data=form)


def make_annex(client, text="Dosage", title="Notice", name="notice.pdf") -> dict:
    response = upload(client, make_pdf(text), name, title=title)
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


# --- upload -----------------------------------------------------------------------------------


def test_upload_stores_the_pdf_under_its_uuid_and_records_metadata(admin_client, annexes_dir, db):
    content = make_pdf("Posologie   adulte\n\n  500 mg")
    response = upload(admin_client, content, "Notice de l'été.pdf", title="  Paracétamol ")
    assert response.status_code == 201
    body = response.json()
    stored = annexes_dir / f"{body['id']}.pdf"
    assert stored.read_bytes() == content
    assert (body["title"], body["filename"]) == ("Paracétamol", "Notice de l'été.pdf")
    assert body["size"] == len(content)
    assert body["sha256"] == hashlib.sha256(content).hexdigest()
    assert body["excerpt"] == "Posologie adulte 500 mg"
    assert "storage_path" not in body
    row = db.get(Annex, uuid.UUID(body["id"]))
    assert row.storage_path == f"{body['id']}.pdf"
    assert actions(db) == ["annex_uploaded"]


def test_excerpt_is_cut_at_about_500_characters(admin_client):
    body = make_annex(admin_client, text="mot " * 300)
    assert len(body["excerpt"]) == 500


def test_excerpt_is_empty_without_text(admin_client):
    response = upload(admin_client, make_pdf())
    assert response.status_code == 201
    assert response.json()["excerpt"] == ""


def test_title_defaults_to_the_file_name(admin_client):
    assert upload(admin_client, make_pdf(), "Guide rapide.PDF").json()["title"] == "Guide rapide"


def test_non_pdf_with_pdf_extension_is_rejected(admin_client, annexes_dir, db):
    response = upload(admin_client, b"MZ\x90\x00 not a pdf", "virus.pdf")
    assert response.status_code == 422
    assert "PDF" in response.json()["detail"]
    assert not annexes_dir.exists() or list(annexes_dir.iterdir()) == []
    assert db.scalar(select(Annex)) is None
    assert actions(db) == []


def test_pdf_content_without_pdf_extension_is_rejected(admin_client):
    assert upload(admin_client, make_pdf(), "notice.exe").status_code == 422


def test_oversize_upload_is_rejected_and_leaves_nothing(admin_client, annexes_dir, db, monkeypatch):
    content = make_pdf("x")
    monkeypatch.setattr(settings, "annex_max_bytes", len(content) - 1)
    response = upload(admin_client, content)
    assert response.status_code == 413
    assert "volumineux" in response.json()["detail"]
    assert list(annexes_dir.iterdir()) == []
    assert db.scalar(select(Annex)) is None


def test_upload_at_exactly_the_limit_is_accepted(admin_client, monkeypatch):
    content = make_pdf("x")
    monkeypatch.setattr(settings, "annex_max_bytes", len(content))
    assert upload(admin_client, content).status_code == 201


def test_default_size_limit_is_20_mib():
    assert type(settings).model_fields["annex_max_bytes"].default == 20 * 1024 * 1024


def test_stored_name_never_derives_from_the_client_filename(admin_client, annexes_dir):
    for name in ("../../etc/evil.pdf", "..\\..\\evil.pdf", "/abs/evil.pdf", "a\r\nb.pdf"):
        body = upload(admin_client, make_pdf(), name).json()
        assert re.fullmatch(r"[0-9a-f-]{36}\.pdf", (annexes_dir / f"{body['id']}.pdf").name)
        assert "/" not in body["filename"] and "\\" not in body["filename"]
        assert "\r" not in body["filename"] and "\n" not in body["filename"]
    assert len(list(annexes_dir.iterdir())) == 4
    assert {p.parent for p in annexes_dir.iterdir()} == {annexes_dir}
    assert not (annexes_dir.parent / "evil.pdf").exists()


# --- download, list, search, edit -------------------------------------------------------------


def test_file_is_served_inline_as_pdf(admin_client, user_client):
    content = make_pdf("Notice")
    annex = upload(admin_client, content, "Notice.pdf").json()
    for client in (admin_client, user_client):
        response = client.get(f"/api/annexes/{annex['id']}/file")
        assert response.status_code == 200
        assert response.content == content
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith('inline; filename="Notice.pdf"')
        assert response.headers["x-content-type-options"] == "nosniff"


def test_content_disposition_is_safe_for_non_ascii_and_quotes(admin_client, db):
    annex = make_annex(admin_client)
    row = db.get(Annex, uuid.UUID(annex["id"]))
    row.filename = 'Fiche "été".pdf'  # multipart clients escape quotes themselves: set it directly
    db.commit()
    header = admin_client.get(f"/api/annexes/{annex['id']}/file").headers["content-disposition"]
    assert header == (
        "inline; filename=\"Fiche __t__.pdf\"; filename*=UTF-8''Fiche%20%22%C3%A9t%C3%A9%22.pdf"
    )


def test_file_missing_on_disk_is_a_404(admin_client, annexes_dir):
    annex = make_annex(admin_client)
    (annexes_dir / f"{annex['id']}.pdf").unlink()
    assert admin_client.get(f"/api/annexes/{annex['id']}/file").status_code == 404


def test_unknown_annex_is_a_404(user_client):
    missing = uuid.uuid4()
    assert user_client.get(f"/api/annexes/{missing}").status_code == 404
    assert user_client.get(f"/api/annexes/{missing}/file").status_code == 404


def test_list_and_search_work_for_both_roles(admin_client, user_client):
    make_annex(admin_client, text="Interactions médicamenteuses", title="Guide Warfarine")
    make_annex(admin_client, text="Conservation au frais", title="Insuline")
    for client in (admin_client, user_client):
        assert [a["title"] for a in client.get("/api/annexes").json()] == [
            "Guide Warfarine",
            "Insuline",
        ]
        assert [a["title"] for a in client.get("/api/annexes?q=warfARINE").json()] == [
            "Guide Warfarine"
        ]
        assert [a["title"] for a in client.get("/api/annexes?q=CONSERVATION").json()] == [
            "Insuline"
        ]
        assert client.get("/api/annexes?q=introuvable").json() == []
        assert len(client.get("/api/annexes?q=%25").json()) == 0  # LIKE wildcards are literal
        assert len(client.get("/api/annexes?q=%20").json()) == 2


def test_admin_edits_title_and_excerpt(admin_client, user_client, db):
    annex = make_annex(admin_client)
    response = admin_client.patch(
        f"/api/annexes/{annex['id']}", json={"title": " Nouveau titre ", "excerpt": "Résumé."}
    )
    assert response.status_code == 200
    assert (response.json()["title"], response.json()["excerpt"]) == ("Nouveau titre", "Résumé.")
    assert user_client.get(f"/api/annexes/{annex['id']}").json()["excerpt"] == "Résumé."
    assert response.json()["sha256"] == annex["sha256"]
    assert actions(db) == ["annex_uploaded", "annex_updated"]


@pytest.mark.parametrize(
    "body", [{"title": ""}, {"title": "x" * 201}, {"filename": "a.pdf"}, {"sha256": "0"}]
)
def test_invalid_edits_are_rejected(admin_client, body):
    annex = make_annex(admin_client)
    assert admin_client.patch(f"/api/annexes/{annex['id']}", json=body).status_code == 422


# --- delete -----------------------------------------------------------------------------------


def test_delete_is_refused_while_the_latest_version_references_the_annex(
    admin_client, annexes_dir, db
):
    annex = make_annex(admin_client)
    add_template(db, "Zèbre", ref(annex["id"]))
    add_template(db, "Alpha", {"categories": []}, ref(annex["id"]))
    add_template(db, "Archivé", ref(annex["id"]), archived=True)
    add_template(db, "Autre", ref(uuid.uuid4()))
    response = admin_client.delete(f"/api/annexes/{annex['id']}")
    assert response.status_code == 409
    assert response.json()["templates"] == ["Alpha", "Archivé", "Zèbre"]
    assert "Alpha, Archivé, Zèbre" in response.json()["detail"]
    assert (annexes_dir / f"{annex['id']}.pdf").exists()
    assert db.get(Annex, uuid.UUID(annex["id"])) is not None
    assert actions(db) == ["annex_uploaded"]


def test_delete_is_allowed_when_only_an_older_version_references_it(admin_client, annexes_dir, db):
    annex = make_annex(admin_client)
    add_template(db, "Ancien", ref(annex["id"]), {"categories": []})
    response = admin_client.delete(f"/api/annexes/{annex['id']}")
    assert response.status_code == 204
    assert not (annexes_dir / f"{annex['id']}.pdf").exists()
    assert db.get(Annex, uuid.UUID(annex["id"])) is None
    assert admin_client.get(f"/api/annexes/{annex['id']}").status_code == 404
    assert actions(db) == ["annex_uploaded", "annex_deleted"]


def test_delete_of_an_unreferenced_annex_and_unknown_id(admin_client):
    annex = make_annex(admin_client)
    assert admin_client.delete(f"/api/annexes/{annex['id']}").status_code == 204
    assert admin_client.delete(f"/api/annexes/{annex['id']}").status_code == 404


# --- authz ------------------------------------------------------------------------------------


def test_user_can_read_but_not_write(admin_client, user_client, db):
    annex = make_annex(admin_client)
    assert user_client.get("/api/annexes").status_code == 200
    assert user_client.get(f"/api/annexes/{annex['id']}").status_code == 200
    assert user_client.get(f"/api/annexes/{annex['id']}/file").status_code == 200
    assert upload(user_client, make_pdf()).status_code == 403
    assert user_client.patch(f"/api/annexes/{annex['id']}", json={"title": "x"}).status_code == 403
    assert user_client.delete(f"/api/annexes/{annex['id']}").status_code == 403
    assert db.scalar(select(Annex.title)) == "Notice"
    assert actions(db) == ["annex_uploaded"]


def test_anonymous_gets_401_everywhere(client, admin_client):
    annex = make_annex(admin_client)
    target = f"/api/annexes/{annex['id']}"
    assert client.get("/api/annexes").status_code == 401
    assert client.get(target).status_code == 401
    assert client.get(f"{target}/file").status_code == 401
    assert upload(client, make_pdf()).status_code == 401
    assert client.patch(target, json={"title": "x"}).status_code == 401
    assert client.delete(target).status_code == 401


def test_admin_writes_need_the_csrf_token(admin_client):
    annex = make_annex(admin_client)
    del admin_client.headers["X-CSRF-Token"]
    assert upload(admin_client, make_pdf()).status_code == 403
    assert admin_client.patch(f"/api/annexes/{annex['id']}", json={"title": "x"}).status_code == 403
    assert admin_client.delete(f"/api/annexes/{annex['id']}").status_code == 403
