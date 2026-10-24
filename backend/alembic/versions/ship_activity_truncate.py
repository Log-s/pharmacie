"""activity_log: reject TRUNCATE too

Revision ID: ship_activity_truncate
Revises: u1_initial
Create Date: 2026-10-25 00:00:00
"""

from alembic import op

revision = "ship_activity_truncate"
down_revision = "u1_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # u1_initial blocks UPDATE and DELETE; TRUNCATE bypasses those triggers.
    op.execute(
        "CREATE TRIGGER activity_log_no_truncate BEFORE TRUNCATE ON activity_log "
        "FOR EACH STATEMENT EXECUTE FUNCTION activity_log_append_only()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER activity_log_no_truncate ON activity_log")
