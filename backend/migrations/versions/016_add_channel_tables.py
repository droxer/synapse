"""Add channel integration tables.

Revision ID: 016
Revises: 015
Create Date: 2026-03-29
"""

from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "8a9a8e2ac3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # channel_accounts
    op.create_table(
        "channel_accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_user_id", sa.String(100), nullable=False),
        sa.Column("provider_chat_id", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column(
            "linked_at",
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
        sa.UniqueConstraint(
            "provider", "provider_user_id", name="uq_channel_account_provider_user"
        ),
    )
    op.create_index("ix_channel_accounts_user_id", "channel_accounts", ["user_id"])
    op.create_index(
        "ix_channel_accounts_provider_lookup",
        "channel_accounts",
        ["provider", "provider_user_id"],
    )

    # channel_sessions
    op.create_table(
        "channel_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "channel_account_id",
            sa.Uuid(),
            sa.ForeignKey("channel_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_chat_id", sa.String(100), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
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
    )
    op.create_index(
        "ix_channel_sessions_account", "channel_sessions", ["channel_account_id"]
    )
    op.create_index(
        "ix_channel_sessions_conversation", "channel_sessions", ["conversation_id"]
    )
    op.create_index(
        "ix_channel_sessions_provider_chat",
        "channel_sessions",
        ["provider", "provider_chat_id"],
    )

    # channel_message_log
    op.create_table(
        "channel_message_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "channel_session_id",
            sa.Uuid(),
            sa.ForeignKey("channel_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("provider_message_id", sa.String(100), nullable=False),
        sa.Column("content_preview", sa.String(500), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="delivered"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("conversation_event_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "channel_session_id",
            "direction",
            "provider_message_id",
            name="uq_channel_msg_dedupe",
        ),
    )
    op.create_index(
        "ix_channel_msg_log_session", "channel_message_log", ["channel_session_id"]
    )
    op.create_index("ix_channel_msg_log_created", "channel_message_log", ["created_at"])

    # channel_link_tokens
    op.create_table(
        "channel_link_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "used", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("token", name="uq_channel_link_token"),
    )
    op.create_index("ix_channel_link_tokens_user", "channel_link_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_table("channel_link_tokens")
    op.drop_table("channel_message_log")
    op.drop_table("channel_sessions")
    op.drop_table("channel_accounts")
