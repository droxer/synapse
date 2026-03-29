"""Add per-user Telegram bot configs.

Revision ID: 017
Revises: 016
Create Date: 2026-03-29
"""

from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_bot_configs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("bot_token", sa.Text(), nullable=False),
        sa.Column("bot_username", sa.String(200), nullable=False),
        sa.Column("bot_user_id", sa.String(100), nullable=False),
        sa.Column("webhook_secret", sa.String(128), nullable=False),
        sa.Column(
            "webhook_status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", name="uq_telegram_bot_configs_user"),
        sa.UniqueConstraint("bot_user_id", name="uq_telegram_bot_configs_bot_user"),
        sa.UniqueConstraint("webhook_secret", name="uq_telegram_bot_configs_secret"),
    )
    op.create_index(
        "ix_telegram_bot_configs_user_id", "telegram_bot_configs", ["user_id"]
    )
    op.create_index(
        "ix_telegram_bot_configs_secret", "telegram_bot_configs", ["webhook_secret"]
    )

    op.add_column(
        "channel_accounts", sa.Column("bot_config_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_channel_accounts_bot_config_id",
        "channel_accounts",
        "telegram_bot_configs",
        ["bot_config_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_channel_accounts_bot_config_id", "channel_accounts", ["bot_config_id"]
    )
    op.drop_constraint(
        "uq_channel_account_provider_user", "channel_accounts", type_="unique"
    )
    op.create_unique_constraint(
        "uq_channel_account_provider_user",
        "channel_accounts",
        ["bot_config_id", "provider", "provider_user_id"],
    )

    op.add_column(
        "channel_sessions", sa.Column("bot_config_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_channel_sessions_bot_config_id",
        "channel_sessions",
        "telegram_bot_configs",
        ["bot_config_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_channel_sessions_bot_config", "channel_sessions", ["bot_config_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_channel_sessions_bot_config", table_name="channel_sessions")
    op.drop_constraint(
        "fk_channel_sessions_bot_config_id", "channel_sessions", type_="foreignkey"
    )
    op.drop_column("channel_sessions", "bot_config_id")

    op.drop_constraint(
        "uq_channel_account_provider_user", "channel_accounts", type_="unique"
    )
    op.create_unique_constraint(
        "uq_channel_account_provider_user",
        "channel_accounts",
        ["provider", "provider_user_id"],
    )
    op.drop_index("ix_channel_accounts_bot_config_id", table_name="channel_accounts")
    op.drop_constraint(
        "fk_channel_accounts_bot_config_id", "channel_accounts", type_="foreignkey"
    )
    op.drop_column("channel_accounts", "bot_config_id")

    op.drop_index("ix_telegram_bot_configs_secret", table_name="telegram_bot_configs")
    op.drop_index("ix_telegram_bot_configs_user_id", table_name="telegram_bot_configs")
    op.drop_table("telegram_bot_configs")
