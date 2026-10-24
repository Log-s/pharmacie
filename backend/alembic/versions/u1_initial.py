"""initial schema

Revision ID: u1_initial
Revises:
Create Date: 2026-10-24 13:41:00.399201
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "u1_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "password_changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("failed_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('admin', 'user')", name=op.f("ck_accounts_role")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
        sa.UniqueConstraint("role", name=op.f("uq_accounts_role")),
    )
    op.create_table(
        "activity_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("account_role", sa.String(length=16), nullable=True),
        sa.Column("profile_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_log")),
    )
    op.create_index(op.f("ix_activity_log_action"), "activity_log", ["action"], unique=False)
    # Journal is append-only (spec §6): any UPDATE or DELETE statement is rejected by the DB.
    op.execute(
        "CREATE FUNCTION activity_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ "
        "BEGIN RAISE EXCEPTION 'activity_log is append-only'; END $$"
    )
    op.execute(
        "CREATE TRIGGER activity_log_append_only BEFORE UPDATE OR DELETE ON activity_log "
        "FOR EACH STATEMENT EXECUTE FUNCTION activity_log_append_only()"
    )
    op.create_table(
        "annexes",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("excerpt", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_annexes")),
    )
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("initials", sa.String(length=4), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_profiles")),
    )
    op.create_table(
        "reference_counters",
        sa.Column("prefix", sa.String(length=32), nullable=False),
        sa.Column("value", sa.BigInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("prefix", name=op.f("pk_reference_counters")),
    )
    op.create_table(
        "templates",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_templates")),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("active_profile_id", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_sessions_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["active_profile_id"],
            ["profiles.id"],
            name=op.f("fk_sessions_active_profile_id_profiles"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    op.create_index(op.f("ix_sessions_account_id"), "sessions", ["account_id"], unique=False)
    op.create_table(
        "template_versions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("schema_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["templates.id"],
            name=op.f("fk_template_versions_template_id_templates"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_template_versions")),
        sa.UniqueConstraint(
            "template_id", "version", name=op.f("uq_template_versions_template_id")
        ),
    )
    op.create_table(
        "forms",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("template_version_id", sa.Uuid(), nullable=False),
        sa.Column("reference", sa.String(length=64), nullable=False),
        sa.Column("owner_profile_id", sa.Uuid(), nullable=False),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_profile_id"],
            ["profiles.id"],
            name=op.f("fk_forms_owner_profile_id_profiles"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_version_id"],
            ["template_versions.id"],
            name=op.f("fk_forms_template_version_id_template_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_forms")),
        sa.UniqueConstraint("reference", name=op.f("uq_forms_reference")),
    )
    op.create_index(op.f("ix_forms_owner_profile_id"), "forms", ["owner_profile_id"], unique=False)
    op.create_index(
        op.f("ix_forms_template_version_id"), "forms", ["template_version_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_forms_template_version_id"), table_name="forms")
    op.drop_index(op.f("ix_forms_owner_profile_id"), table_name="forms")
    op.drop_table("forms")
    op.drop_table("template_versions")
    op.drop_index(op.f("ix_sessions_account_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("templates")
    op.drop_table("reference_counters")
    op.drop_table("profiles")
    op.drop_table("annexes")
    op.drop_index(op.f("ix_activity_log_action"), table_name="activity_log")
    op.drop_table("activity_log")
    op.execute("DROP FUNCTION activity_log_append_only()")
    op.drop_table("accounts")
