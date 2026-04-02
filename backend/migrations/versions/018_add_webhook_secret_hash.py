"""Add webhook_secret_hash to telegram_bot_configs for secure lookup.

Revision ID: 018
Revises: 017
Create Date: 2026-04-02
"""

import hashlib

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "telegram_bot_configs",
        sa.Column("webhook_secret_hash", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_telegram_bot_configs_secret_hash",
        "telegram_bot_configs",
        ["webhook_secret_hash"],
    )

    # Backfill hash for existing rows
    bind = op.get_bind()
    rows = bind.execute(
        text(
            "SELECT id, webhook_secret FROM telegram_bot_configs WHERE webhook_secret_hash IS NULL"
        )
    ).fetchall()
    for row_id, secret in rows:
        secret_hash = hashlib.sha256(secret.encode()).hexdigest()
        bind.execute(
            text(
                "UPDATE telegram_bot_configs SET webhook_secret_hash = :h WHERE id = :id"
            ),
            {"h": secret_hash, "id": str(row_id)},
        )


def downgrade() -> None:
    op.drop_index(
        "ix_telegram_bot_configs_secret_hash", table_name="telegram_bot_configs"
    )
    op.drop_column("telegram_bot_configs", "webhook_secret_hash")
