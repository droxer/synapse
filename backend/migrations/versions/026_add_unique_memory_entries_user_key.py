"""Deduplicate user-scoped memory entries and add unique key index.

Revision ID: 026
Revises: 025
Create Date: 2026-04-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id, namespace, key
                        ORDER BY updated_at DESC, created_at DESC, id DESC
                    ) AS row_num
                FROM memory_entries
                WHERE user_id IS NOT NULL
            )
            DELETE FROM memory_entries
            WHERE id IN (
                SELECT id
                FROM ranked
                WHERE row_num > 1
            )
            """
        )
    )
    op.create_index(
        "ux_memory_entries_user_namespace_key",
        "memory_entries",
        ["user_id", "namespace", "key"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"),
        sqlite_where=sa.text("user_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_memory_entries_user_namespace_key", table_name="memory_entries")
