"""Add id column to token_usage and switch PK from conversation_id to id.

Revision ID: 015
Revises: 014
Create Date: 2026-03-22
"""

from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add UUID id column
    op.add_column(
        "token_usage",
        sa.Column(
            "id", sa.Uuid(), nullable=False, server_default=sa.text("gen_random_uuid()")
        ),
    )

    # Drop the old PK on conversation_id
    op.drop_constraint("token_usage_pkey", "token_usage", type_="primary")

    # Create new PK on id
    op.create_primary_key("token_usage_pkey", "token_usage", ["id"])

    # Add unique index on conversation_id (needed for ON CONFLICT upsert)
    op.create_index(
        "ix_token_usage_conversation",
        "token_usage",
        ["conversation_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_token_usage_conversation", table_name="token_usage")
    op.drop_constraint("token_usage_pkey", "token_usage", type_="primary")
    op.create_primary_key("token_usage_pkey", "token_usage", ["conversation_id"])
    op.drop_column("token_usage", "id")
