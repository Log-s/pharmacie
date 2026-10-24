import pytest
import weasyprint
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError

from alembic import command
from app.cli import ALEMBIC_INI
from app.config.reference import format_reference, is_valid_reference
from app.db import engine

SPEC_TABLES = {
    "accounts",
    "profiles",
    "templates",
    "template_versions",
    "forms",
    "annexes",
    "reference_counters",
    "activity_log",
    "sessions",
}


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
    assert format_reference(42) == "FIXME-000042"
    assert is_valid_reference("FIXME-000042")
    for bad in ("FIXME-42", "FIXME-0000420", "fixme-000042", "FIXME-٠٠٠٠٤٢", " FIXME-000042"):
        assert not is_valid_reference(bad)


def test_weasyprint_renders_offline():
    assert weasyprint.HTML(string="<p>Fiche</p>").write_pdf().startswith(b"%PDF-")
