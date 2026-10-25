"""PDF export (spec §3.3): content, footer, headers, journal, offline rendering."""

import io
import socket
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from pypdf import PdfReader

from app.models import Annex
from app.pdf import render
from tests.test_forms_common import created, journal, publish, uid

REF, DATE, AUTHOR, CAT, TEXT, LONG, RADIO, R1, R2, CHECKS, C1, C2, C3 = (uid() for _ in range(13))
CHILD_OK, CHILD_HIDDEN, ANNEX_NODE = uid(), uid(), uid()
ANNEX = str(uuid.uuid4())  # never inserted: the PDF prints « Annexe supprimée »
LINES = "\n".join(f"Ligne {n}" for n in range(1, 51))
NODES = [
    {"id": REF, "type": "reference", "label": "Réf. interne"},
    {"id": DATE, "type": "date", "label": "Date du contrôle"},
    {"id": AUTHOR, "type": "author", "label": "Contrôleur"},
    {
        "id": CAT,
        "type": "category",
        "label": "Chambre froide",
        "children": [
            {"id": TEXT, "type": "text", "label": "Observation"},
            {"id": LONG, "type": "text", "label": "Détail", "multiline": True},
            {
                "id": RADIO,
                "type": "radio_group",
                "label": "Résultat",
                "annex_ref": {"annex_id": ANNEX},
                "options": [{"id": R1, "label": "Conforme"}, {"id": R2, "label": "Rejeté"}],
            },
            {
                "id": CHECKS,
                "type": "checkbox_group",
                "label": "Vérifications",
                "options": [
                    {
                        "id": C1,
                        "label": "Étiquette lisible",
                        "children": [{"id": CHILD_OK, "type": "text", "label": "Précision"}],
                    },
                    {"id": C2, "label": "Emballage abîmé"},
                    {
                        "id": C3,
                        "label": "Lot périmé",
                        "children": [{"id": CHILD_HIDDEN, "type": "text", "label": "Enfant caché"}],
                    },
                ],
            },
        ],
    },
]


@pytest.fixture
def exported(db, make_client, profile_factory):
    """(response, pages' text, form) for a user's form long enough for two pages."""
    alice = profile_factory("Alice Durand")
    bruno = profile_factory("Bruno Martin", color="#16a34a")
    client = make_client("user", alice)
    version = publish(db, NODES, name="Contrôle réception")
    data = {
        DATE: "2026-10-24",
        AUTHOR: str(bruno.id),
        TEXT: "Tout va bien",
        LONG: LINES,
        RADIO: R1,
        CHECKS: [C1, C2],
        CHILD_OK: "Texte enfant visible",
    }
    form = created(client, version, data, reference="03-2026-042")
    response = client.get(f"/api/forms/{form['id']}/pdf")
    pages = [p.extract_text() for p in PdfReader(io.BytesIO(response.content)).pages]
    return response, pages, form


def test_content_shows_checked_only(exported):
    _, pages, _ = exported
    text = "\n".join(pages)
    for expected in (
        "Contrôle réception",
        "Profil propriétaire",
        "Alice Durand",  # form owner (header)
        "Créée le",
        "Bruno Martin",  # author field
        "24/10/2026",
        "Chambre froide",
        "Tout va bien",
        "Conforme",
        "Étiquette lisible",
        "Texte enfant visible",
        "Emballage abîmé",
        "Annexe supprimée",
        "Ligne 50",
    ):
        assert expected in text
    for absent in ("Rejeté", "Lot périmé", "Enfant caché", "Réf. interne"):
        assert absent not in text


def test_header_date_is_the_creation_day_in_paris(exported):
    _, pages, form = exported
    created = datetime.fromisoformat(form["created_at"]).astimezone(ZoneInfo("Europe/Paris"))
    assert f"Créée le {created:%d/%m/%Y}" in pages[0].replace("\n", " ")


def test_footer_on_every_page(exported):
    _, pages, _ = exported
    assert len(pages) == 2
    for number, page in enumerate(pages, 1):
        assert "03-2026-042" in page.rsplit("Référence : ", 1)[-1]
        assert f"Page {number} / 2" in page


def test_pdf_response_and_journal(exported, db):
    response, _, form = exported
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == 'attachment; filename="03-2026-042.pdf"'
    assert response.content.startswith(b"%PDF-")
    row = journal(db)[-1]
    assert (row.action, row.target_type, row.target_id) == ("form_export", "form", form["id"])
    assert row.details["reference"] == "03-2026-042"
    assert row.account_role == "user"
    assert row.profile_id is not None


def test_admin_exports_any_form_and_annex_title(db, make_client, admin_client, profile_factory):
    db.add(Annex(id=uuid.UUID(ANNEX), title="Procédure froid", body_html="", body_text=""))
    db.commit()
    client = make_client("user", profile_factory())
    form = created(client, publish(db, NODES), {RADIO: R1})
    response = admin_client.get(f"/api/forms/{form['id']}/pdf")
    assert response.status_code == 200
    text = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
    assert "Procédure froid" in text
    assert "Annexe supprimée" not in text
    row = journal(db)[-1]
    assert (row.action, row.account_role, row.profile_id) == ("form_export", "admin", None)


def test_unknown_form_404_anonymous_401(client, admin_client):
    assert admin_client.get(f"/api/forms/{uuid.uuid4()}/pdf").status_code == 404
    assert client.get(f"/api/forms/{uuid.uuid4()}/pdf").status_code == 401


def test_user_text_cannot_inject_remote_resources(db, make_client, profile_factory, monkeypatch):
    evil = (
        '<img src="https://example.com/x.png"><style>@import url(http://example.com/a.css);</style>'
    )
    client = make_client("user", profile_factory())
    form = created(client, publish(db, NODES), {TEXT: evil})

    def no_network(*_args, **_kwargs):
        raise AssertionError("network access during rendering")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    response = client.get(f"/api/forms/{form['id']}/pdf")
    assert response.status_code == 200
    assert "<img src=" in PdfReader(io.BytesIO(response.content)).pages[0].extract_text()


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/x.png",
        "https://example.com/a.css",
        "file:///etc/passwd",
        "data:text/css,a{}",
        f"file://{render.PDF_DIR}/%2e%2e/x",
        f"file://{render.PDF_DIR}/%2E%2E%2Fx",
        f"file://host/{render.PDF_DIR}/form.css",
    ],
)
def test_fetcher_refuses_outside_resources(url, monkeypatch):
    monkeypatch.setattr(socket.socket, "connect", pytest.fail)
    with pytest.raises(ValueError, match="refusée"):
        render.LocalFetcher().fetch(url)


def test_fetcher_allows_package_files():
    assert render.LocalFetcher().fetch((render.PDF_DIR / "form.css").as_uri()).read()
