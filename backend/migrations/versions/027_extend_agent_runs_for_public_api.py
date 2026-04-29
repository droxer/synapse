"""Extend agent_runs for public integration API.

Revision ID: 027
Revises: 026
Create Date: 2026-04-28
"""

from alembic import op
import sqlalchemy as sa

revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("api_key_hash", sa.String(64), nullable=True))
    op.add_column(
        "agent_runs", sa.Column("idempotency_key", sa.String(128), nullable=True)
    )
    op.add_column("agent_runs", sa.Column("error", sa.JSON(), nullable=True))
    op.add_column(
        "agent_runs",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_agent_runs_api_idempotency",
        "agent_runs",
        ["api_key_hash", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_agent_runs_api_idempotency", table_name="agent_runs")
    op.drop_column("agent_runs", "updated_at")
    op.drop_column("agent_runs", "error")
    op.drop_column("agent_runs", "idempotency_key")
    op.drop_column("agent_runs", "api_key_hash")
