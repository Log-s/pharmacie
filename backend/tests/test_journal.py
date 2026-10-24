"""Journal read API (spec §6): admin only, filters, pagination, append-only."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.main import app
from app.models import ActivityLog


def at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 3, day, hour, tzinfo=UTC)


@pytest.fixture
def rows(db, profile_factory):
    """Six rows over three days: two profiles, three actions."""
    a, b = profile_factory("Alice", "AL"), profile_factory("Bob", "BO", "#dc2626")
    spec = [
        (at(1), None, "login_success"),
        (at(1, 18), a.id, "form_create"),
        (at(2), a.id, "form_update"),
        (at(2, 18), b.id, "form_create"),
        (at(3, 0), b.id, "form_update"),
        (at(3, 23), None, "logout"),
    ]
    db.add_all(
        ActivityLog(at=when, profile_id=pid, action=action, account_role="user", details={"n": i})
        for i, (when, pid, action) in enumerate(spec)
    )
    db.commit()
    return {"a": a, "b": b}


def get(client, **params):
    response = client.get("/api/journal", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def ns(body) -> list[int]:
    return [item["details"]["n"] for item in body["items"]]


def test_newest_first_with_profile_name(admin_client, rows):
    body = get(admin_client)
    assert body["total"] == 6
    assert ns(body) == [5, 4, 3, 2, 1, 0]
    assert body["items"][0]["profile_name"] is None
    assert body["items"][1]["profile_name"] == "Bob"
    assert body["items"][-1]["account_role"] == "user"


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"from": "2026-03-02"}, [5, 4, 3, 2]),
        ({"to": "2026-03-02"}, [3, 2, 1, 0]),  # `to` is inclusive of the whole day
        ({"from": "2026-03-02", "to": "2026-03-02"}, [3, 2]),
        ({"action": "form_create"}, [3, 1]),
        ({"action": "nope"}, []),
        ({"from": "2026-03-04"}, []),
        ({"to": "9999-12-31"}, [5, 4, 3, 2, 1, 0]),  # no date overflow on the upper bound
        ({"from": "0001-01-01"}, [5, 4, 3, 2, 1, 0]),
    ],
)
def test_filters_date_and_action(admin_client, rows, params, expected):
    body = get(admin_client, **params)
    assert ns(body) == expected
    assert body["total"] == len(expected)


def test_filter_profile_and_combined(admin_client, rows):
    assert ns(get(admin_client, profile_id=str(rows["a"].id))) == [2, 1]
    assert ns(get(admin_client, profile_id=str(rows["b"].id), action="form_update")) == [4]
    combined = get(
        admin_client,
        profile_id=str(rows["a"].id),
        action="form_create",
        **{"from": "2026-03-01", "to": "2026-03-01"},
    )
    assert ns(combined) == [1]
    assert get(admin_client, profile_id=str(rows["a"].id), action="logout")["total"] == 0


def test_pagination_total_is_unpaged(admin_client, rows):
    first = get(admin_client, page=1, page_size=4)
    second = get(admin_client, page=2, page_size=4)
    assert (first["total"], second["total"]) == (6, 6)
    assert ns(first) == [5, 4, 3, 2]
    assert ns(second) == [1, 0]
    assert get(admin_client, page=3, page_size=4)["items"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page": 100_001},
        {"page": 10**30},
        {"page_size": 0},
        {"page_size": 201},
        {"from": "x"},
    ],
)
def test_bad_query_is_422(admin_client, params):
    assert admin_client.get("/api/journal", params=params).status_code == 422


def test_actions_are_read_from_the_table(admin_client, db, rows):
    assert admin_client.get("/api/journal/actions").json() == [
        "form_create",
        "form_update",
        "login_success",
        "logout",
    ]
    db.add(ActivityLog(action="annex_upload"))
    db.commit()
    assert "annex_upload" in admin_client.get("/api/journal/actions").json()


@pytest.mark.parametrize("path", ["/api/journal", "/api/journal/actions"])
def test_user_403_anonymous_401(user_client, client, path):
    assert user_client.get(path).status_code == 403
    assert client.get(path).status_code == 401


def test_journal_has_no_write_route():
    paths = {p: ops for p, ops in app.openapi()["paths"].items() if p.startswith("/api/journal")}
    assert set(paths) == {"/api/journal", "/api/journal/actions"}
    assert all(set(ops) == {"get"} for ops in paths.values())


@pytest.mark.parametrize(
    "sql",
    ["UPDATE activity_log SET action = 'x'", "DELETE FROM activity_log", "TRUNCATE activity_log"],
)
def test_trigger_rejects_update_delete_and_truncate(db, sql):
    db.add(ActivityLog(action="login_success"))
    db.commit()
    with pytest.raises(DBAPIError, match="append-only"):
        db.execute(text(sql))
    db.rollback()


def test_unstorable_action_filter_is_422(admin_client):
    # A lone surrogate cannot reach the server in a URL (it decodes to U+FFFD): NUL is the case.
    assert admin_client.get("/api/journal", params={"action": "a\x00b"}).status_code == 422
