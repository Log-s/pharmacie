import pytest
import weasyprint
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from alembic import command
from app.cli import ALEMBIC_INI
from app.config.reference import format_reference, is_valid_reference
from app.db import engine
from app.main import create_app
from app.settings import settings

SPEC_TABLES = {
    "accounts",
    "profiles",
    "templates",
    "template_versions",
    "forms",
    "annexes",
    "annex_folders",
    "reference_counters",
    "activity_log",
    "sessions",
}


@pytest.mark.parametrize("path", ["/api/docs", "/api/redoc", "/api/openapi.json"])
def test_api_docs_are_off_by_default_and_opt_in(client, monkeypatch, path):
    assert client.get(path).status_code == 404
    monkeypatch.setattr(settings, "expose_api_docs", True)
    assert TestClient(create_app()).get(path).status_code == 200


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_migration_creates_every_spec_table():
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) == SPEC_TABLES | {"alembic_version"}
    uniques = {
        table: [u["column_names"] for u in inspector.get_unique_constraints(table)]
        for table in ("accounts", "forms")
    }
    assert ["role"] in uniques["accounts"]
    assert ["reference"] in uniques["forms"]


def test_models_match_migrations():
    command.check(Config(str(ALEMBIC_INI)))  # raises if autogenerate would emit a change


def test_profile_number_migration_converts_initials_and_downgrades():
    cfg = Config(str(ALEMBIC_INI))
    command.downgrade(cfg, "ship_activity_truncate")
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO profiles (display_name, initials, color, archived_at, created_at)"
                    " VALUES ('Troisième', 'TR', '#000000', NULL, '2026-03-01'),"
                    " ('Premier', 'PR', '#000000', now(), '2026-01-01'),"
                    " ('Deuxième', 'DE', '#000000', NULL, '2026-02-01')"
                )
            )
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            rows = conn.execute(text("SELECT display_name, number FROM profiles ORDER BY number"))
            assert rows.all() == [("Premier", 1), ("Deuxième", 2), ("Troisième", 3)]
            assert "initials" not in {c["name"] for c in inspect(conn).get_columns("profiles")}
        insert = "INSERT INTO profiles (display_name, number, color) VALUES ('X', {n}, '#000000')"
        for number in (2, 0, 1000):  # active duplicate, below and above the CHECK range
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(text(insert.format(n=number)))
        with engine.begin() as conn:  # the archived profile's number 1 is free again
            conn.execute(text(insert.format(n=1)))
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM profiles WHERE display_name = 'X'"))
        command.downgrade(cfg, "ship_activity_truncate")
        with engine.begin() as conn:
            columns = {c["name"] for c in inspect(conn).get_columns("profiles")}
            assert {"initials"} <= columns and "number" not in columns
            initials = conn.execute(text("SELECT initials FROM profiles ORDER BY created_at"))
            assert initials.scalars().all() == ["1", "2", "3"]
    finally:
        command.upgrade(cfg, "head")


@pytest.mark.parametrize(
    "statement", ["UPDATE activity_log SET action = 'edited'", "DELETE FROM activity_log"]
)
def test_activity_log_rejects_update_and_delete(db, statement):
    db.execute(text("INSERT INTO activity_log (action) VALUES ('login')"))
    db.commit()
    with pytest.raises(DBAPIError, match="append-only"):
        db.execute(text(statement))
    db.rollback()
    assert db.execute(text("SELECT action FROM activity_log")).scalars().all() == ["login"]


def test_reference_format():
    assert format_reference("10-2026", 42) == "10-2026-042"
    assert format_reference("10-2026", 1000) == "10-2026-1000"
    for good in ("10-2026-001", "01-2026-042", "12-1999-999", "10-2026-1000", "10-2026-12345"):
        assert is_valid_reference(good)
    bad_values = ("13-2026-001", "00-2026-001", "10-2026-0001", "10-26-001", "AB-000001")
    more_bad = ("10-2026-01", "10-2026-001\n", " 10-2026-001", "١٠-٢٠٢٦-٠٤٢", "10-2026-00a")
    for bad in (*bad_values, *more_bad):
        assert not is_valid_reference(bad)


def test_weasyprint_renders_offline():
    assert weasyprint.HTML(string="<p>Fiche</p>").write_pdf().startswith(b"%PDF-")
