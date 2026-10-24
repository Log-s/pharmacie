"""Fixtures: real Postgres (compose.test.yaml), migrated once per session, truncated per test.

Clients use https://testserver so the Secure session cookie is sent back. Reusable by every
unit: `accounts`, `make_client(role, profile=None, app=app)`, `admin_client`, `user_client`,
`login(client, role, password=None)`, `profile_factory(...)`."""

from contextlib import ExitStack
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.cli import main as cli
from app.db import SessionLocal, engine
from app.main import app as main_app
from app.models import Account, Base, Profile
from app.services import passwords, ratelimit, sessions

BASE_URL = "https://testserver"
PASSWORDS = {"admin": "orbite-cactus-fanfare-41", "user": "violon-agrafe-marelle-77"}


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cli(["migrate"])


@pytest.fixture(autouse=True)
def _truncate_tables():
    ratelimit.reset()
    yield
    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        # The journal refuses TRUNCATE: lift that guard for this reset only (same transaction).
        conn.execute(text("ALTER TABLE activity_log DISABLE TRIGGER activity_log_no_truncate"))
        # Table names come from our own metadata, not from input.
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))  # noqa: S608
        conn.execute(text("ALTER TABLE activity_log ENABLE TRIGGER activity_log_no_truncate"))


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    with TestClient(main_app, base_url=BASE_URL) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def _password_hashes():
    return {role: passwords.hash_password(pw) for role, pw in PASSWORDS.items()}


@pytest.fixture
def accounts(db, _password_hashes) -> dict[str, Account]:
    """The installed admin and user accounts (passwords in PASSWORDS)."""
    rows = {role: Account(role=role, password_hash=h) for role, h in _password_hashes.items()}
    db.add_all(rows.values())
    db.commit()
    return rows


@pytest.fixture
def make_client(db, accounts):
    """make_client(role, profile=None, app=main_app): a TestClient with a fresh server session
    (created directly, no Argon2 cost), the X-CSRF-Token header preset, optional active profile.
    The session token is on `client.session_token`."""
    with ExitStack() as stack:

        def make(role: str, profile: Profile | None = None, app=main_app) -> TestClient:
            token = sessions.create(db, accounts[role].id)
            db.commit()
            if profile is not None:
                session, _ = sessions.load(db, token)
                sessions.set_active_profile(db, session, profile.id)
                db.commit()
            test_client = stack.enter_context(TestClient(app, base_url=BASE_URL))
            test_client.cookies.set(sessions.COOKIE, token)
            test_client.headers[sessions.CSRF_HEADER] = sessions.csrf_token(token)
            test_client.session_token = token
            return test_client

        yield make


@pytest.fixture
def admin_client(make_client):
    return make_client("admin")


@pytest.fixture
def user_client(make_client):
    """User session without an active profile; use make_client("user", profile) for one."""
    return make_client("user")


@pytest.fixture
def login():
    """login(client, role, password=None) -> response; on success presets the CSRF header."""

    def do_login(test_client: TestClient, role: str, password: str | None = None):
        response = test_client.post(
            "/api/auth/login", json={"role": role, "password": password or PASSWORDS[role]}
        )
        if response.status_code == 200:
            test_client.headers[sessions.CSRF_HEADER] = response.json()["csrf_token"]
        return response

    return do_login


@pytest.fixture
def profile_factory(db):
    """profile_factory(display_name="Profil A", initials="PA", color="#2563eb", archived=False)"""

    def make(display_name="Profil A", initials="PA", color="#2563eb", archived=False) -> Profile:
        profile = Profile(
            display_name=display_name,
            initials=initials,
            color=color,
            archived_at=datetime.now(UTC) if archived else None,
        )
        db.add(profile)
        db.commit()
        return profile

    return make
