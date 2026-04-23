"""Add headers support to mcp_servers.

Revision ID: 025
Revises: 024
Create Date: 2026-04-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if "mcp_servers" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("mcp_servers")}
    if "headers" not in columns:
        op.add_column(
            "mcp_servers",
            sa.Column("headers", sa.Text(), nullable=False, server_default="{}"),
        )

    # Existing String(10) cannot store "streamablehttp".
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "mcp_servers",
            "transport",
            existing_type=sa.String(length=10),
            type_=sa.String(length=32),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if "mcp_servers" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("mcp_servers")}
    if "headers" in columns:
        op.drop_column("mcp_servers", "headers")

    if bind.dialect.name == "postgresql":
        op.alter_column(
            "mcp_servers",
            "transport",
            existing_type=sa.String(length=32),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
