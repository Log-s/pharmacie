"""annexes: HTML notes in a folder tree replace the uploaded PDFs

Revision ID: annex_notes
Revises: profile_number
Create Date: 2026-10-25 23:00:00
"""

import sqlalchemy as sa

from alembic import op

revision = "annex_notes"
# profile_number already follows ship_activity_truncate: chaining here keeps a single head.
down_revision = "profile_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Fresh installs only: uploaded PDFs are not converted to notes.
    op.execute("DELETE FROM annexes")
    for column in ("filename", "storage_path", "size", "sha256", "excerpt"):
        op.drop_column("annexes", column)
    op.create_table(
        "annex_folders",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["annex_folders.id"],
            name=op.f("fk_annex_folders_parent_id_annex_folders"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_annex_folders")),
    )
    op.add_column("annexes", sa.Column("folder_id", sa.Uuid(), nullable=True))
    op.add_column("annexes", sa.Column("body_html", sa.Text(), nullable=False))
    op.add_column("annexes", sa.Column("body_text", sa.Text(), nullable=False))
    op.add_column(
        "annexes",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        op.f("fk_annexes_folder_id_annex_folders"),
        "annexes",
        "annex_folders",
        ["folder_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_annexes_folder_id"), "annexes", ["folder_id"])


def downgrade() -> None:
    op.execute("DELETE FROM annexes")  # the old columns are NOT NULL and notes have no PDF
    op.drop_index(op.f("ix_annexes_folder_id"), table_name="annexes")
    op.drop_constraint(op.f("fk_annexes_folder_id_annex_folders"), "annexes", type_="foreignkey")
    for column in ("updated_at", "body_text", "body_html", "folder_id"):
        op.drop_column("annexes", column)
    op.drop_table("annex_folders")
    op.add_column("annexes", sa.Column("filename", sa.String(length=255), nullable=False))
    op.add_column("annexes", sa.Column("storage_path", sa.String(length=500), nullable=False))
    op.add_column("annexes", sa.Column("size", sa.BigInteger(), nullable=False))
    op.add_column("annexes", sa.Column("sha256", sa.String(length=64), nullable=False))
    op.add_column("annexes", sa.Column("excerpt", sa.Text(), server_default="", nullable=False))
