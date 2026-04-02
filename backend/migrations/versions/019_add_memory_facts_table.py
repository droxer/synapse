"""Add memory facts tables for long-term fact compression.

Revision ID: 019
Revises: 018
Create Date: 2026-04-02
"""

import sqlalchemy as sa
from alembic import op

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "memory_facts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("namespace", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_chat_id", sa.String(length=128), nullable=True),
        sa.Column("evidence_snippet", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_memory_facts_user", "memory_facts", ["user_id"])
    op.create_index("ix_memory_facts_namespace", "memory_facts", ["namespace"])
    op.create_index("ix_memory_facts_updated", "memory_facts", ["updated_at"])
    op.create_index("ix_memory_facts_last_seen", "memory_facts", ["last_seen_at"])
    op.create_index(
        "ix_memory_facts_lookup",
        "memory_facts",
        ["user_id", "namespace", "key", "status"],
    )

    op.create_table(
        "memory_fact_ingestions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("turn_id", sa.String(length=100), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_memory_fact_ingestions_turn",
        "memory_fact_ingestions",
        ["conversation_id", "turn_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_memory_fact_ingestions_turn",
        table_name="memory_fact_ingestions",
    )
    op.drop_table("memory_fact_ingestions")

    op.drop_index("ix_memory_facts_lookup", table_name="memory_facts")
    op.drop_index("ix_memory_facts_last_seen", table_name="memory_facts")
    op.drop_index("ix_memory_facts_updated", table_name="memory_facts")
    op.drop_index("ix_memory_facts_namespace", table_name="memory_facts")
    op.drop_index("ix_memory_facts_user", table_name="memory_facts")
    op.drop_table("memory_facts")
