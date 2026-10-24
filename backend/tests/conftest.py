"""Fixtures: real Postgres (compose.test.yaml), migrated once per session, truncated per test."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.cli import main as cli
from app.db import SessionLocal, engine
from app.main import app
from app.models import Base


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cli(["migrate"])


@pytest.fixture(autouse=True)
def _truncate_tables():
    yield
    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        # Table names come from our own metadata, not from input.
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))  # noqa: S608


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
