"""Add orchestrator mode to conversations.

Revision ID: 021
Revises: 020
Create Date: 2026-04-11
"""

import sqlalchemy as sa
from alembic import op

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "orchestrator_mode",
            sa.String(length=20),
            nullable=False,
            server_default="agent",
        ),
    )
    op.alter_column("conversations", "orchestrator_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("conversations", "orchestrator_mode")
