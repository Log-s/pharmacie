import subprocess
import sys

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.cli import main as cli
from app.db import engine
from app.models import Account, ActivityLog, AuthSession, Profile
from app.services import passwords, sessions
from tests.conftest import PASSWORDS

NEW_ADMIN = "girafe-tunnel-paprika-93"


@pytest.fixture
def password_file(tmp_path):
    def write(password: str) -> str:
        path = tmp_path / f"pw{len(list(tmp_path.iterdir()))}"
        path.write_text(password + "\n")
        return str(path)

    return write


def install_args(password_file, admin=PASSWORDS["admin"], user=PASSWORDS["user"]) -> list[str]:
    return [
        "install",
        "--admin-password-file",
        password_file(admin),
        "--user-password-file",
        password_file(user),
    ]


def hashes(db) -> dict[str, str]:
    db.expire_all()
    return dict(db.execute(select(Account.role, Account.password_hash)).all())


def test_install_creates_both_accounts(password_file, db):
    cli([*install_args(password_file), "--profile", "Marie Curie"])
    stored = hashes(db)
    assert stored.keys() == {"admin", "user"}
    assert all(h.startswith("$argon2id$") for h in stored.values())
    assert passwords.verify_password(stored["admin"], PASSWORDS["admin"])
    assert passwords.verify_password(stored["user"], PASSWORDS["user"])
    profile = db.scalar(select(Profile))
    assert (profile.display_name, profile.number) == ("Marie Curie", 1)


def test_install_without_profile_creates_none(password_file, db):
    cli(install_args(password_file))
    assert db.scalar(select(func.count()).select_from(Profile)) == 0


def test_second_install_fails_and_creates_nothing(password_file, db):
    cli(install_args(password_file))
    before = hashes(db)
    with pytest.raises(SystemExit) as exit_info:
        cli(install_args(password_file, NEW_ADMIN, "carafe-mistral-ondine-18"))
    assert "déjà installée" in exit_info.value.code
    assert hashes(db) == before


def test_second_install_exits_non_zero(password_file, accounts):
    result = subprocess.run(  # noqa: S603 (fixed argv)
        [sys.executable, "-m", "app.cli", *install_args(password_file)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "déjà installée" in result.stderr


def test_install_is_one_transaction(password_file, db):
    """A failure on the second insert (user) must not leave the admin account behind."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE FUNCTION fail_user_insert() RETURNS trigger LANGUAGE plpgsql AS $$ "
                "BEGIN RAISE EXCEPTION 'boom'; END $$"
            )
        )
        conn.execute(
            text(
                "CREATE TRIGGER fail_user_insert BEFORE INSERT ON accounts FOR EACH ROW "
                "WHEN (NEW.role = 'user') EXECUTE FUNCTION fail_user_insert()"
            )
        )
    try:
        with pytest.raises(DBAPIError, match="boom"):
            cli(install_args(password_file))
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP FUNCTION fail_user_insert() CASCADE"))
    assert hashes(db) == {}


@pytest.mark.parametrize(
    ("admin", "user", "message"),
    [
        ("Court-1!", PASSWORDS["user"], "au moins 12 caractères"),
        (PASSWORDS["admin"], "password1234", "trop facile"),
        (PASSWORDS["admin"], PASSWORDS["admin"], "mots de passe différents"),
    ],
)
def test_install_refuses_weak_passwords(password_file, db, admin, user, message):
    with pytest.raises(SystemExit) as exit_info:
        cli(install_args(password_file, admin, user))
    assert message in exit_info.value.code
    assert hashes(db) == {}


def test_install_interactive_prompts(monkeypatch, db, capsys):
    typed = iter(
        [
            "court",
            PASSWORDS["admin"],
            "faute-de-frappe-xyz",
            PASSWORDS["admin"],
            PASSWORDS["admin"],
            PASSWORDS["user"],
            PASSWORDS["user"],
        ]
    )
    monkeypatch.setattr("app.cli.getpass", lambda _prompt: next(typed))
    monkeypatch.setattr("builtins.input", lambda _prompt: "Louis Pasteur")
    cli(["install"])
    assert "12 caractères" in capsys.readouterr().err
    assert passwords.verify_password(hashes(db)["admin"], PASSWORDS["admin"])
    assert db.scalar(select(Profile.number)) == 1


def test_reset_admin_password(password_file, accounts, db):
    admin_id, user_id = accounts["admin"].id, accounts["user"].id
    for account_id in (admin_id, admin_id, user_id):
        sessions.create(db, account_id)
    db.commit()
    cli(["reset-admin-password", "--password-file", password_file(NEW_ADMIN)])
    stored = hashes(db)
    assert passwords.verify_password(stored["admin"], NEW_ADMIN)
    assert passwords.verify_password(stored["user"], PASSWORDS["user"])
    remaining = db.scalars(select(AuthSession.account_id)).all()
    assert remaining == [user_id]
    row = db.scalar(select(ActivityLog))
    assert (row.action, row.account_role, row.target_id, row.details) == (
        "password_reset",
        None,
        "admin",
        {"via": "cli"},
    )


def test_reset_admin_password_refuses_a_weak_password(password_file, accounts, db):
    before = hashes(db)
    with pytest.raises(SystemExit) as exit_info:
        cli(["reset-admin-password", "--password-file", password_file("motdepasse12")])
    assert "trop facile" in exit_info.value.code
    assert hashes(db) == before
    assert db.scalar(select(func.count()).select_from(ActivityLog)) == 0


def test_reset_admin_password_requires_an_installed_instance(password_file):
    with pytest.raises(SystemExit) as exit_info:
        cli(["reset-admin-password", "--password-file", password_file(NEW_ADMIN)])
    assert "installation" in exit_info.value.code
