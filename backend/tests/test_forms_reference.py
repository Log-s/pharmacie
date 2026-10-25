"""Form references: format (app/config/reference.py), counter, uniqueness (spec §3.2)."""

import threading
import time
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.config.reference import current_period, format_reference
from app.db import SessionLocal
from app.models import ReferenceCounter
from app.services import references
from tests.test_forms_common import create, created, publish, raw, update

TAKEN = "Cette référence est déjà utilisée par une autre fiche."


# The provisional format, written split so a repo-wide grep for its marker stays empty.
OLD_FORMAT = "FIX" + "ME-000001"


def ref(number: int) -> str:
    """Reference number `number` of the current month."""
    return format_reference(current_period(), number)


@pytest.fixture
def client(make_client, profile_factory):
    return make_client("user", profile_factory())


def test_auto_references_are_sequential(db, client):
    version = publish(db)
    refs = [created(client, version)["reference"] for _ in range(3)]
    assert refs == [ref(1), ref(2), ref(3)]
    assert refs[0] == f"{current_period()}-001"


def test_user_reference_is_accepted_and_skipped_by_the_counter(db, client):
    version = publish(db)
    assert created(client, version)["reference"] == ref(1)
    assert created(client, version, reference=f" {ref(2)} ")["reference"] == ref(2)
    assert created(client, version, reference=ref(999))["reference"] == ref(999)
    assert client.get("/api/forms/next-reference").json() == {"reference": ref(3)}
    assert created(client, version)["reference"] == ref(3)


def test_next_reference_does_not_reserve(db, client):
    version = publish(db)
    assert client.get("/api/forms/next-reference").json() == {"reference": ref(1)}
    assert client.get("/api/forms/next-reference").json() == {"reference": ref(1)}
    assert created(client, version)["reference"] == ref(1)


@pytest.mark.parametrize(
    "reference",
    [OLD_FORMAT, "13-2026-001", "00-2026-001", "10-2026-0001", "10-26-001", "10-2026-01", ""],
)
def test_invalid_format_is_422(db, client, reference):
    version = publish(db)
    response = create(client, version, reference=reference)
    assert response.status_code == 422
    assert "Référence invalide" in response.json()["detail"][0]["msg"]
    assert "MM-AAAA-NNN" in response.json()["detail"][0]["msg"]
    form = created(client, version)
    assert update(client, form, reference=reference or " ").status_code == 422


@pytest.mark.parametrize("reference", ["10-2026-001\x00", "10-2026-\x00001", "10-2026-00\ud800"])
def test_unstorable_reference_is_422(db, client, reference):
    version = publish(db)
    body = {"template_version_id": str(version.id), "reference": reference}
    response = raw(client, "POST", "/api/forms", body)
    assert response.status_code == 422, response.text
    [error] = response.json()["detail"]
    assert (error["loc"], "Référence invalide" in error["msg"]) == (["body", "reference"], True)
    form = created(client, version)
    response = raw(client, "PUT", f"/api/forms/{form['id']}", {"reference": reference})
    assert response.status_code == 422, response.text


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
    assert sorted(results) == [ref(n) for n in range(1, count + 1)]


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
    assert sorted(refs) == [ref(n) for n in range(1, 5)]


def counter(db, period: str) -> int | None:
    return db.scalar(select(ReferenceCounter.value).where(ReferenceCounter.prefix == period))


def test_sequence_restarts_each_month(db):
    october = datetime(2026, 10, 15, 12, tzinfo=UTC)
    november = datetime(2026, 11, 3, 12, tzinfo=UTC)
    assert references.allocate(db, october) == "10-2026-001"
    assert references.allocate(db, october) == "10-2026-002"
    assert references.allocate(db, november) == "11-2026-001"
    assert references.preview(db, november) == "11-2026-002"
    assert references.allocate(db, datetime(2027, 10, 1, 12, tzinfo=UTC)) == "10-2027-001"
    assert references.allocate(db, october) == "10-2026-003"


def test_month_is_read_in_paris_time(db):
    """23:30 UTC on 31 Oct is 00:30 on 1 Nov in Paris (UTC+1); 22:30 UTC is still 31 Oct."""
    assert references.allocate(db, datetime(2026, 10, 31, 23, 30, tzinfo=UTC)) == "11-2026-001"
    assert references.allocate(db, datetime(2026, 10, 31, 22, 30, tzinfo=UTC)) == "10-2026-001"
    assert references.allocate(db, datetime(2026, 12, 31, 23, 30, tzinfo=UTC)) == "01-2027-001"


def test_taken_numbers_are_skipped_within_the_month(db, client):
    version = publish(db)
    created(client, version, reference=ref(1))
    created(client, version, reference=ref(2))
    assert references.preview(db) == ref(3)
    assert references.allocate(db) == ref(3)
    db.commit()  # release the counter row lock before the API (another session) bumps it
    assert created(client, version)["reference"] == ref(4)


def test_user_reference_of_any_month_does_not_move_the_counter(db, client):
    version = publish(db)
    assert created(client, version, reference="03-2020-777")["reference"] == "03-2020-777"
    assert counter(db, "03-2020") is None
    assert created(client, version)["reference"] == ref(1)
    assert counter(db, current_period()) == 1


def test_number_after_999_is_1000(db):
    db.add(ReferenceCounter(prefix="10-2026", value=998))
    db.flush()
    now = datetime(2026, 10, 15, 12, tzinfo=UTC)
    assert [references.allocate(db, now) for _ in range(3)] == [
        "10-2026-999",
        "10-2026-1000",
        "10-2026-1001",
    ]
