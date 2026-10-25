from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.api.deps import CurrentAuth
from app.models import Account, ActivityLog, AuthSession
from app.services import passwords, ratelimit, sessions
from app.settings import settings
from tests.conftest import BASE_URL, PASSWORDS

UNSAFE = ["POST", "PUT", "PATCH", "DELETE"]


def actions(db) -> list[str]:
    return db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)).all()


def session_count(db) -> int:
    return db.scalar(select(func.count()).select_from(AuthSession))


# --- passwords -------------------------------------------------------------------------------


def test_password_hash_is_argon2id():
    hashed = passwords.hash_password(PASSWORDS["admin"])
    assert hashed.startswith("$argon2id$")
    assert passwords.verify_password(hashed, PASSWORDS["admin"])
    assert not passwords.verify_password(hashed, PASSWORDS["user"])
    assert not passwords.verify_password("not-a-hash", PASSWORDS["admin"])


@pytest.mark.parametrize(
    ("password", "message"),
    [
        ("Court-1!", "au moins 12 caractères"),
        ("password1234", "trop facile"),
        ("aaaaaaaaaaaaaaaa", "trop facile"),
        (PASSWORDS["admin"], None),
    ],
)
def test_password_policy_in_french(password, message):
    error = passwords.check_policy(password)
    assert error is None if message is None else message in error


# --- login, me, logout -----------------------------------------------------------------------


def test_login_sets_secure_session_cookie(client, accounts, login):
    response = login(client, "admin")
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    name, token = cookie.split(";")[0].split("=", 1)
    attributes = {part.strip().lower() for part in cookie.split(";")[1:]}
    assert name == sessions.COOKIE and len(token) >= 43  # token_urlsafe(32)
    assert {"httponly", "secure", "samesite=strict", "path=/"} <= attributes
    assert response.json() == {
        "role": "admin",
        "active_profile": None,
        "csrf_token": sessions.csrf_token(token),
    }
    assert PASSWORDS["admin"] not in response.text


def test_session_is_stored_server_side_as_a_hash(client, accounts, login, db):
    login(client, "user")
    token = client.cookies[sessions.COOKIE]
    stored = db.scalars(select(AuthSession.id)).all()
    assert len(stored) == 1 and stored[0] != token


def test_me_returns_role_active_profile_and_csrf(client, accounts, login):
    csrf = login(client, "user").json()["csrf_token"]
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"role": "user", "active_profile": None, "csrf_token": csrf}


def test_me_shows_the_active_profile_unless_archived(make_client, profile_factory, db):
    profile = profile_factory("Marie Curie", 7, "#123456")
    user = make_client("user", profile)
    assert user.get("/api/auth/me").json()["active_profile"] == {
        "id": str(profile.id),
        "display_name": "Marie Curie",
        "number": 7,
        "color": "#123456",
    }
    profile.archived_at = datetime.now(UTC)
    db.commit()
    assert user.get("/api/auth/me").json()["active_profile"] is None


def test_me_without_session_is_401(client):
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(sessions.COOKIE, "forged")
    assert client.get("/api/auth/me").status_code == 401


def test_wrong_password_is_401_in_french(client, accounts, login, db):
    response = login(client, "admin", "pas-le-bon-mot-de-passe")
    assert response.status_code == 401
    assert response.json()["detail"] == "Mot de passe incorrect."
    assert "set-cookie" not in response.headers
    assert session_count(db) == 0


def test_login_success_is_logged(client, accounts, login, db):
    login(client, "user")
    row = db.scalar(select(ActivityLog))
    assert (row.action, row.account_role, row.target_id) == ("login_success", "user", "user")
    assert row.details == {"ip": "testclient"}


def test_logout_invalidates_the_session_server_side(client, accounts, login, db):
    login(client, "admin")
    token = client.cookies[sessions.COOKIE]
    response = client.post("/api/auth/logout")
    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert session_count(db) == 0
    client.cookies.set(sessions.COOKIE, token)  # replaying the old cookie does not work
    assert client.get("/api/auth/me").status_code == 401
    assert actions(db) == ["login_success", "logout"]


def test_idle_expired_session_is_401(admin_client, db):
    db.execute(update(AuthSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    assert admin_client.get("/api/auth/me").status_code == 401
    assert session_count(db) == 0


def test_sliding_expiry_extends_an_active_session(admin_client, db):
    soon = datetime.now(UTC) + timedelta(minutes=1)
    db.execute(update(AuthSession).values(expires_at=soon))
    db.commit()
    assert admin_client.get("/api/auth/me").status_code == 200
    expires_at = db.scalar(select(AuthSession.expires_at))
    idle = timedelta(minutes=settings.session_idle_minutes)
    assert expires_at > datetime.now(UTC) + idle - timedelta(seconds=30)


# --- CSRF ------------------------------------------------------------------------------------

probe = FastAPI()


@probe.api_route("/probe", methods=["GET", *UNSAFE])
def probe_route(auth: CurrentAuth) -> dict[str, str]:
    return {"role": auth.role}


@pytest.mark.parametrize("method", UNSAFE)
@pytest.mark.parametrize("csrf", [None, "", "wrong"])
def test_unsafe_method_without_valid_csrf_is_403(make_client, method, csrf):
    probe_client = make_client("user", app=probe)
    if csrf is None:
        del probe_client.headers[sessions.CSRF_HEADER]
    else:
        probe_client.headers[sessions.CSRF_HEADER] = csrf
    response = probe_client.request(method, "/probe")
    assert response.status_code == 403
    assert "CSRF" in response.json()["detail"]
    assert probe_client.get("/probe").status_code == 200  # safe methods need no token


@pytest.mark.parametrize("method", UNSAFE)
def test_unsafe_method_with_csrf_passes(make_client, method):
    assert make_client("user", app=probe).request(method, "/probe").json() == {"role": "user"}


def test_csrf_token_of_another_session_is_rejected(make_client):
    first, second = make_client("user", app=probe), make_client("user", app=probe)
    first.headers[sessions.CSRF_HEADER] = second.headers[sessions.CSRF_HEADER]
    assert first.post("/probe").status_code == 403


def test_logout_without_csrf_is_403_and_keeps_the_session(admin_client, db):
    del admin_client.headers[sessions.CSRF_HEADER]
    assert admin_client.post("/api/auth/logout").status_code == 403
    assert session_count(db) == 1


# --- lockout and rate limit ------------------------------------------------------------------


def account(db, role: str) -> Account:
    db.expire_all()
    return db.scalar(select(Account).where(Account.role == role))


def test_lockout_after_threshold_failures(client, accounts, login, db):
    threshold = settings.lockout_threshold
    for _ in range(threshold - 1):
        assert login(client, "user", "mauvais-mot-de-passe").status_code == 401
    response = login(client, "user", "mauvais-mot-de-passe")
    assert response.status_code == 423
    assert response.json()["detail"].startswith("Compte verrouillé")
    assert "Réessayez dans 1 minute." in response.json()["detail"]
    assert int(response.headers["retry-after"]) == settings.lockout_base_seconds
    user = account(db, "user")
    assert user.failed_attempts == threshold
    assert user.locked_until > datetime.now(UTC)
    assert actions(db) == ["login_failure"] * threshold + ["account_locked"]


def test_lockout_refuses_the_correct_password(client, accounts, login, db):
    locked_until = datetime.now(UTC) + timedelta(minutes=5)
    db.execute(
        update(Account)
        .where(Account.role == "user")
        .values(failed_attempts=settings.lockout_threshold, locked_until=locked_until)
    )
    db.commit()
    response = login(client, "user")
    assert response.status_code == 423
    assert "Réessayez dans 5 minutes." in response.json()["detail"]
    assert "set-cookie" not in response.headers
    assert account(db, "user").failed_attempts == settings.lockout_threshold
    row = db.scalar(select(ActivityLog))
    assert (row.action, row.details["reason"]) == ("login_failure", "locked")


def test_lockout_is_progressive_and_capped(client, accounts, login, db):
    def fail_after_expired_lock(attempts: int) -> int:
        db.execute(
            update(Account)
            .where(Account.role == "user")
            .values(failed_attempts=attempts, locked_until=datetime.now(UTC) - timedelta(1))
        )
        db.commit()
        response = login(client, "user", "mauvais-mot-de-passe")
        assert response.status_code == 423
        return int(response.headers["retry-after"])

    base, threshold = settings.lockout_base_seconds, settings.lockout_threshold
    assert fail_after_expired_lock(threshold) == 2 * base
    assert fail_after_expired_lock(threshold + 1) == 4 * base
    assert fail_after_expired_lock(threshold + 40) == settings.lockout_max_seconds


def test_lock_success_resets_the_counter(client, accounts, login, db):
    for _ in range(2):
        login(client, "admin", "mauvais-mot-de-passe")
    assert account(db, "admin").failed_attempts == 2
    assert login(client, "admin").status_code == 200
    admin = account(db, "admin")
    assert (admin.failed_attempts, admin.locked_until) == (0, None)


def test_lock_expired_allows_login(client, accounts, login, db):
    db.execute(
        update(Account)
        .where(Account.role == "admin")
        .values(failed_attempts=9, locked_until=datetime.now(UTC) - timedelta(seconds=1))
    )
    db.commit()
    assert login(client, "admin").status_code == 200
    assert account(db, "admin").failed_attempts == 0


def test_login_rate_limit_per_ip_returns_429(client, accounts, login, monkeypatch):
    monkeypatch.setattr(settings, "login_rate_limit", 3)
    for _ in range(3):
        assert login(client, "admin").status_code == 200
    response = login(client, "admin")
    assert response.status_code == 429
    assert response.json()["detail"].startswith("Trop de tentatives")
    assert response.headers["retry-after"] == "60"
    other_ip = TestClient(client.app, base_url=BASE_URL, client=("10.0.0.2", 5000))
    assert login(other_ip, "admin").status_code == 200


def test_rate_limiter_window():
    assert ratelimit.allow("a", 1) and not ratelimit.allow("a", 1)
    assert ratelimit.allow("b", 1)
    assert ratelimit.allow("a", 1, window=0)  # hits older than the window are forgotten


def test_rate_limiter_forgets_idle_keys(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: clock[0])
    assert ratelimit.allow("login:10.0.0.9", 5)
    clock[0] += ratelimit.WINDOW_SECONDS
    assert ratelimit.allow("login:10.0.0.10", 5)
    assert "login:10.0.0.9" not in ratelimit._hits


@pytest.mark.parametrize(
    "body",
    [
        {"password": PASSWORDS["admin"]},  # missing role
        {"role": "root", "password": PASSWORDS["admin"]},
        {"role": "admin", "password": "orbite-cactus-" * 80},  # over max_length
    ],
)
def test_login_validation_error_does_not_echo_the_password(client, body):
    response = client.post("/api/auth/login", json=body)
    assert response.status_code == 422
    assert body["password"] not in response.text
    assert {"type", "loc", "msg"} == set(response.json()["detail"][0])
