"""Add FK constraints on memory_entries/mcp_servers user_id, add mcp unique(user_id, name).

Revision ID: 008
Revises: 007
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add FK constraint on memory_entries.user_id
    op.create_foreign_key(
        "fk_memory_entries_user_id",
        "memory_entries",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Add FK constraint on mcp_servers.user_id
    op.create_foreign_key(
        "fk_mcp_servers_user_id",
        "mcp_servers",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Add per-user unique constraint on mcp_servers(user_id, name)
    op.create_unique_constraint(
        "uq_mcp_servers_user_name",
        "mcp_servers",
        ["user_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_mcp_servers_user_name", "mcp_servers", type_="unique")
    op.drop_constraint("fk_mcp_servers_user_id", "mcp_servers", type_="foreignkey")
    op.drop_constraint("fk_memory_entries_user_id", "memory_entries", type_="foreignkey")
