"""Add users table, add user_id to conversations/memory_entries/mcp_servers.

Revision ID: 006
Revises: 005
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import UUID

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    # --- users table ---
    if "users" not in existing_tables:
        op.create_table(
            "users",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("google_id", sa.String(50), unique=True, nullable=False),
            sa.Column("email", sa.String(320), unique=True, nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("picture", sa.String(500), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    # --- conversations.user_id ---
    conv_columns = [c["name"] for c in inspector.get_columns("conversations")]
    if "user_id" not in conv_columns:
        op.add_column(
            "conversations",
            sa.Column(
                "user_id",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_conversations_user_id", "conversations", ["user_id"])

    # --- memory_entries.user_id ---
    if "memory_entries" in existing_tables:
        mem_columns = [c["name"] for c in inspector.get_columns("memory_entries")]
        if "user_id" not in mem_columns:
            op.add_column(
                "memory_entries",
                sa.Column("user_id", UUID(as_uuid=True), nullable=True),
            )
            op.create_index("ix_memory_user", "memory_entries", ["user_id"])

    # --- mcp_servers.user_id ---
    if "mcp_servers" in existing_tables:
        mcp_columns = [c["name"] for c in inspector.get_columns("mcp_servers")]
        if "user_id" not in mcp_columns:
            op.add_column(
                "mcp_servers",
                sa.Column("user_id", UUID(as_uuid=True), nullable=True),
            )
            op.create_index("ix_mcp_servers_user", "mcp_servers", ["user_id"])
            # Drop unique constraint on name (now scoped per user, not globally unique)
            op.drop_constraint("mcp_servers_name_key", "mcp_servers", type_="unique")


def downgrade() -> None:
    # mcp_servers
    op.create_unique_constraint("mcp_servers_name_key", "mcp_servers", ["name"])
    op.drop_index("ix_mcp_servers_user", table_name="mcp_servers")
    op.drop_column("mcp_servers", "user_id")

    # memory_entries
    op.drop_index("ix_memory_user", table_name="memory_entries")
    op.drop_column("memory_entries", "user_id")

    # conversations
    op.drop_index("ix_conversations_user_id", table_name="conversations")
    op.drop_column("conversations", "user_id")

    # users
    op.drop_table("users")
