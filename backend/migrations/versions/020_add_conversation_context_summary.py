"""Add rolling context summary for compaction cold-start.

Revision ID: 020
Revises: 019
Create Date: 2026-04-03
"""

import sqlalchemy as sa
from alembic import op

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("context_summary", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "context_summary")
