"""Form references: format (app/config/reference.py), counter, uniqueness (spec §3.2)."""

import threading
import time

import pytest

from app.config.reference import format_reference
from app.db import SessionLocal
from app.services import references
from tests.test_forms_common import create, created, publish, update

TAKEN = "Cette référence est déjà utilisée par une autre fiche."


@pytest.fixture
def client(make_client, profile_factory):
    return make_client("user", profile_factory())


def test_auto_references_are_sequential(db, client):
    version = publish(db)
    refs = [created(client, version)["reference"] for _ in range(3)]
    assert refs == ["FIXME-000001", "FIXME-000002", "FIXME-000003"]
    assert refs == [format_reference(n) for n in (1, 2, 3)]


def test_user_reference_is_accepted_and_skipped_by_the_counter(db, client):
    version = publish(db)
    assert created(client, version)["reference"] == "FIXME-000001"
    assert created(client, version, reference=" FIXME-000002 ")["reference"] == "FIXME-000002"
    assert created(client, version, reference="FIXME-999999")["reference"] == "FIXME-999999"
    assert client.get("/api/forms/next-reference").json() == {"reference": "FIXME-000003"}
    assert created(client, version)["reference"] == "FIXME-000003"


def test_next_reference_does_not_reserve(db, client):
    version = publish(db)
    assert client.get("/api/forms/next-reference").json() == {"reference": "FIXME-000001"}
    assert client.get("/api/forms/next-reference").json() == {"reference": "FIXME-000001"}
    assert created(client, version)["reference"] == "FIXME-000001"


@pytest.mark.parametrize(
    "reference", ["FIXME-12", "fixme-000001", "FIXME-0000001", "XFIXME-000001", "FIXME-00001a", ""]
)
def test_invalid_format_is_422(db, client, reference):
    version = publish(db)
    response = create(client, version, reference=reference)
    assert response.status_code == 422
    assert "Référence invalide" in response.json()["detail"][0]["msg"]
    form = created(client, version)
    assert update(client, form, reference=reference or " ").status_code == 422


def test_duplicate_is_409_on_create_and_update(db, client):
    version = publish(db)
    first, second = created(client, version), created(client, version)
    response = create(client, version, reference=first["reference"])
    assert (response.status_code, response.json()["detail"]) == (409, TAKEN)
    response = update(client, second, reference=first["reference"])
    assert (response.status_code, response.json()["detail"]) == (409, TAKEN)
    assert update(client, second, reference=second["reference"]).status_code == 200


def test_race_past_the_check_is_409_from_the_unique_constraint(db, client, monkeypatch):
    version = publish(db)
    first = created(client, version)
    monkeypatch.setattr(references, "taken", lambda _db, _ref: False)
    response = create(client, version, reference=first["reference"])
    assert (response.status_code, response.json()["detail"]) == (409, TAKEN)


def test_concurrent_allocations_never_share_a_number():
    """Each thread holds the counter lock a while; the others must wait, not reuse the value."""
    count, results, barrier = 8, [], threading.Barrier(8)

    def allocate():
        with SessionLocal() as session:
            barrier.wait()
            reference = references.allocate(session)
            time.sleep(0.05)
            session.commit()
            results.append(reference)

    threads = [threading.Thread(target=allocate) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == [format_reference(n) for n in range(1, count + 1)]


def test_concurrent_creates_get_distinct_references(db, make_client, profile_factory):
    version = publish(db)
    clients = [make_client("user", profile_factory(f"P{i}", f"P{i}")) for i in range(4)]
    statuses, refs = [], []

    def post(test_client):
        response = create(test_client, version)
        statuses.append(response.status_code)
        refs.append(response.json().get("reference"))

    threads = [threading.Thread(target=post, args=(c,)) for c in clients]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert statuses == [201] * 4
    assert sorted(refs) == [format_reference(n) for n in range(1, 5)]
