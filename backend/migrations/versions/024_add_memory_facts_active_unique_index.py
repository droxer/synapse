"""Add partial unique index for active memory facts.

Revision ID: 024
Revises: 023
Create Date: 2026-04-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "024"
down_revision = "023"
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
                FROM memory_facts
                WHERE status = 'active'
            )
            UPDATE memory_facts
            SET status = 'stale'
            WHERE id IN (
                SELECT id
                FROM ranked
                WHERE row_num > 1
            )
            """
        )
    )
    op.create_index(
        "ux_memory_facts_active_key",
        "memory_facts",
        ["user_id", "namespace", "key"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("ux_memory_facts_active_key", table_name="memory_facts")
