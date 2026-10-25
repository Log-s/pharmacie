"""Server-side commands: python -m app.cli {migrate,install,reset-admin-password}.

Passwords are typed at a masked prompt (with confirmation), or read from a file for scripted
installs (tests, e2e): --admin-password-file / --user-password-file / --password-file."""

import argparse
import sys
from getpass import getpass
from pathlib import Path

from alembic.config import Config
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.db import SessionLocal
from app.models import Account, Profile
from app.services import activity, auth, passwords

ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"
FIRST_PROFILE_COLOR = "#2563eb"


def migrate(_args: argparse.Namespace) -> None:
    command.upgrade(Config(str(ALEMBIC_INI)), "head")


def ask_password(label: str, path: str | None) -> str:
    """From the file (exit on a weak password) or the masked prompt (asks again until valid)."""
    if path:
        password = Path(path).read_text().rstrip("\r\n")
        if error := passwords.check_policy(password):
            sys.exit(f"Mot de passe {label} refusé : {error}")
        return password
    while True:
        password = getpass(f"Mot de passe {label} : ")
        if error := passwords.check_policy(password):
            print(error, file=sys.stderr)
        elif getpass("Confirmez le mot de passe : ") != password:
            print("Les deux saisies ne correspondent pas.", file=sys.stderr)
        else:
            return password


def install(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Account)):
            sys.exit("L'instance est déjà installée : aucun compte n'a été créé.")
    admin = ask_password("du compte admin", args.admin_password_file)
    user = ask_password("du compte utilisateur", args.user_password_file)
    if user == admin:
        sys.exit("Les comptes admin et utilisateur doivent avoir des mots de passe différents.")
    profile = args.profile
    if profile is None and not (args.admin_password_file or args.user_password_file):
        profile = input("Nom du premier profil (laisser vide pour ne pas en créer) : ")
    profile = (profile or "").strip()[:100]
    try:
        with SessionLocal.begin() as db:  # one transaction: both accounts (and the profile) or none
            db.add(Account(role="admin", password_hash=passwords.hash_password(admin)))
            db.flush()
            db.add(Account(role="user", password_hash=passwords.hash_password(user)))
            if profile:
                db.add(Profile(display_name=profile, number=1, color=FIRST_PROFILE_COLOR))
    except IntegrityError:  # a concurrent install won the race on UNIQUE(role)
        sys.exit("L'instance est déjà installée : aucun compte n'a été créé.")
    print("Installation terminée : comptes admin et utilisateur créés.")


def reset_admin_password(args: argparse.Namespace) -> None:
    with SessionLocal() as db:
        if db.scalar(select(Account).where(Account.role == "admin")) is None:
            sys.exit("Aucun compte admin : lancez d'abord l'installation.")
    password = ask_password("du compte admin", args.password_file)
    with SessionLocal.begin() as db:
        admin = db.scalar(select(Account).where(Account.role == "admin").with_for_update())
        auth.set_password(db, admin, password)  # also closes every admin session
        activity.log(db, activity.CLI, "password_reset", "account", "admin", {"via": "cli"})
    print("Mot de passe admin réinitialisé ; les sessions admin ont été fermées.")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="applique les migrations").set_defaults(func=migrate)
    p = sub.add_parser("install", help="crée les comptes admin et utilisateur")
    p.add_argument("--admin-password-file")
    p.add_argument("--user-password-file")
    p.add_argument("--profile", help="nom du premier profil (sinon demandé)")
    p.set_defaults(func=install)
    p = sub.add_parser("reset-admin-password", help="réinitialise le mot de passe admin")
    p.add_argument("--password-file")
    p.set_defaults(func=reset_admin_password)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
