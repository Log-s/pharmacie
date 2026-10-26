"""Annex PDF export: heading hierarchy from the chosen node, pruning, h6 cap, roles."""

import io

from pypdf import PdfReader

from tests.test_annexes import make_folder, make_note


def export(client, folder_id=None):
    url = "/api/annexes/export.pdf" + (f"?folder_id={folder_id}" if folder_id else "")
    return client.get(url)


def read(response) -> PdfReader:
    assert response.status_code == 200, response.text
    return PdfReader(io.BytesIO(response.content))


def outline(reader):
    """[(depth, title)] of the bookmarks WeasyPrint makes from h1..h6."""
    flat = []

    def walk(items, depth):
        for item in items:
            if isinstance(item, list):
                walk(item, depth + 1)
            else:
                flat.append((depth, item.title))

    walk(reader.outline, 1)
    return flat


def text(reader) -> str:
    return " ".join(page.extract_text() for page in reader.pages)


def test_order_is_folder_subfolder_note_then_content(admin_client):
    top = make_folder(admin_client, "Protocoles")
    sub = make_folder(admin_client, "Froid", top["id"])
    make_note(admin_client, "Relevé", "<h1>Étapes</h1><p>Vérifier le frigo</p>", sub["id"])
    make_note(admin_client, "Intro", "<p>Bienvenue</p>", top["id"])
    response = export(admin_client, top["id"])
    assert response.headers["content-type"] == "application/pdf"
    assert "Protocoles.pdf" in response.headers["content-disposition"]
    reader = read(response)
    assert outline(reader) == [
        (1, "Protocoles"),
        (2, "Froid"),
        (3, "Relevé"),
        (4, "Étapes"),  # the note's h1 is shifted under its h3 title
        (2, "Intro"),
    ]
    body = text(reader)
    assert body.index("Protocoles") < body.index("Froid") < body.index("Relevé")
    assert body.index("Relevé") < body.index("Vérifier le frigo") < body.index("Intro")


def test_export_starts_at_the_chosen_subfolder(admin_client):
    top = make_folder(admin_client, "Protocoles")
    chosen = make_folder(admin_client, "Froid", top["id"])
    other = make_folder(admin_client, "Chaud", top["id"])
    make_note(admin_client, "Relevé", "<p>a</p>", chosen["id"])
    make_note(admin_client, "Autre", "<p>b</p>", other["id"])
    make_note(admin_client, "Racine", "<p>c</p>")
    reader = read(export(admin_client, chosen["id"]))
    assert outline(reader) == [(1, "Froid"), (2, "Relevé")]
    assert all(word not in text(reader) for word in ("Chaud", "Autre", "Racine", "Protocoles"))


def test_root_export_starts_with_annexes(admin_client):
    folder = make_folder(admin_client, "Zèbre")
    make_note(admin_client, "Bravo", "<p>x</p>", folder["id"])
    make_note(admin_client, "Alpha", "<p>y</p>")
    response = export(admin_client)
    assert 'filename="Annexes.pdf"' in response.headers["content-disposition"]
    assert outline(read(response)) == [
        (1, "Annexes"),
        (2, "Zèbre"),
        (3, "Bravo"),
        (2, "Alpha"),
    ]


def test_subtrees_without_notes_are_omitted(admin_client):
    top = make_folder(admin_client, "Protocoles")
    empty = make_folder(admin_client, "Vide", top["id"])
    make_folder(admin_client, "Encore vide", empty["id"])
    full = make_folder(admin_client, "Plein", top["id"])
    make_note(admin_client, "Note", "<p>x</p>", full["id"])
    assert outline(read(export(admin_client, top["id"]))) == [
        (1, "Protocoles"),
        (2, "Plein"),
        (3, "Note"),
    ]
    # An export of a folder with no note at all is just its title.
    assert outline(read(export(admin_client, empty["id"]))) == [(1, "Vide")]


def test_headings_are_capped_at_h6_in_a_deep_tree(admin_client):
    parent = None
    for depth in range(7):
        parent = make_folder(admin_client, f"Niveau{depth}", parent and parent["id"])
        if depth == 0:
            top = parent
    make_note(admin_client, "Fond", "<h1>A</h1><h3>B</h3><p>texte</p>", parent["id"])
    levels = outline(read(export(admin_client, top["id"])))
    assert levels[:6] == [(n, f"Niveau{n - 1}") for n in range(1, 7)]
    # Niveau6 (depth 6), the note title and both shifted headings all stay at h6.
    assert levels[6:] == [(6, "Niveau6"), (6, "Fond"), (6, "A"), (6, "B")]


def test_unknown_folder_is_a_404(admin_client):
    response = export(admin_client, "00000000-0000-4000-8000-000000000001")
    assert response.status_code == 404
    assert response.json()["detail"] == "Dossier introuvable."


def test_user_can_export(admin_client, user_client):
    folder = make_folder(admin_client, "Protocoles")
    make_note(admin_client, "Note", "<p>x</p>", folder["id"])
    assert outline(read(export(user_client, folder["id"])))[0] == (1, "Protocoles")
    assert outline(read(export(user_client)))[0] == (1, "Annexes")


def test_a_too_deeply_nested_note_is_a_422_not_a_500(admin_client, monkeypatch):
    def overflow(*_):
        raise RecursionError

    monkeypatch.setattr("app.pdf.annexes.render", overflow)
    response = export(admin_client)
    assert response.status_code == 422
    assert response.json()["detail"] == "Une note est trop imbriquée pour être exportée en PDF."

