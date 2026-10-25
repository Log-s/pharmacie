"""profiles: number (unique among active profiles) replaces initials

Revision ID: profile_number
Revises: ship_activity_truncate
Create Date: 2026-10-25 22:00:00
"""

import sqlalchemy as sa

from alembic import op

revision = "profile_number"
down_revision = "ship_activity_truncate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("number", sa.SmallInteger(), nullable=True))
    # Numbered over ALL profiles (archived included), oldest first: unique overall, so the
    # partial index below cannot fail on existing data.
    op.execute(
        "UPDATE profiles SET number = n.rn FROM "
        "(SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM profiles) AS n "
        "WHERE profiles.id = n.id"
    )
    op.alter_column("profiles", "number", nullable=False)
    op.create_check_constraint(
        op.f("ck_profiles_number_range"), "profiles", "number BETWEEN 1 AND 999"
    )
    op.create_index(
        op.f("uq_profiles_number_active"),
        "profiles",
        ["number"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    op.drop_column("profiles", "initials")


def downgrade() -> None:
    op.add_column("profiles", sa.Column("initials", sa.String(length=4), nullable=True))
    op.execute("UPDATE profiles SET initials = number::text")
    op.alter_column("profiles", "initials", nullable=False)
    op.drop_index(op.f("uq_profiles_number_active"), table_name="profiles")
    op.drop_constraint(op.f("ck_profiles_number_range"), "profiles", type_="check")
    op.drop_column("profiles", "number")
