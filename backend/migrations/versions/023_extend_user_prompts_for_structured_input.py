"""Extend user prompts for structured input and approvals.

Revision ID: 023
Revises: 022
Create Date: 2026-04-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_prompts",
        sa.Column(
            "prompt_kind",
            sa.String(length=32),
            nullable=False,
            server_default="freeform",
        ),
    )
    op.add_column(
        "user_prompts",
        sa.Column("title", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "user_prompts",
        sa.Column("options", sa.JSON(), nullable=True),
    )
    op.add_column(
        "user_prompts",
        sa.Column("prompt_metadata", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_prompts", "prompt_metadata")
    op.drop_column("user_prompts", "options")
    op.drop_column("user_prompts", "title")
    op.drop_column("user_prompts", "prompt_kind")
