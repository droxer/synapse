"""Add user_id to memory_entries and mcp_servers tables.

Revision ID: 007
Revises: 006
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import UUID

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # --- memory_entries.user_id ---
    if "memory_entries" in inspector.get_table_names():
        mem_columns = [c["name"] for c in inspector.get_columns("memory_entries")]
        if "user_id" not in mem_columns:
            op.add_column(
                "memory_entries",
                sa.Column("user_id", UUID(as_uuid=True), nullable=True),
            )
            op.create_index("ix_memory_user", "memory_entries", ["user_id"])

    # --- mcp_servers.user_id ---
    if "mcp_servers" in inspector.get_table_names():
        mcp_columns = [c["name"] for c in inspector.get_columns("mcp_servers")]
        if "user_id" not in mcp_columns:
            op.add_column(
                "mcp_servers",
                sa.Column("user_id", UUID(as_uuid=True), nullable=True),
            )
            op.create_index("ix_mcp_servers_user", "mcp_servers", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_mcp_servers_user", table_name="mcp_servers")
    op.drop_column("mcp_servers", "user_id")
    op.drop_index("ix_memory_user", table_name="memory_entries")
    op.drop_column("memory_entries", "user_id")
