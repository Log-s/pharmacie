"""Server-side commands: python -m app.cli {migrate,install,reset-admin-password}."""

import argparse
import sys
from pathlib import Path

from alembic.config import Config

from alembic import command

ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"


def migrate(_args: argparse.Namespace) -> None:
    command.upgrade(Config(str(ALEMBIC_INI)), "head")


def not_implemented(args: argparse.Namespace) -> None:
    sys.exit(f"{args.command} : pas encore implémenté.")  # stub, filled by U2


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="applique les migrations").set_defaults(func=migrate)
    sub.add_parser("install", help="crée les comptes admin et utilisateur").set_defaults(
        func=not_implemented
    )
    sub.add_parser("reset-admin-password", help="réinitialise le mot de passe admin").set_defaults(
        func=not_implemented
    )
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
