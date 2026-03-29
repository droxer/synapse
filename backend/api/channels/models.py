"""SQLAlchemy ORM models for channel integrations.

These models are internal to the channel repository layer.
All public APIs return frozen DTOs from ``schemas.py``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from agent.state.models import Base, ConversationModel, UserModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TelegramBotConfigModel(Base):
    """Per-user Telegram bot configuration."""

    __tablename__ = "telegram_bot_configs"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_telegram_bot_configs_user"),
        UniqueConstraint("bot_user_id", name="uq_telegram_bot_configs_bot_user"),
        UniqueConstraint("webhook_secret", name="uq_telegram_bot_configs_secret"),
        Index("ix_telegram_bot_configs_user_id", "user_id"),
        Index("ix_telegram_bot_configs_secret", "webhook_secret"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    bot_token: Mapped[str] = mapped_column(Text, nullable=False)
    bot_username: Mapped[str] = mapped_column(String(200), nullable=False)
    bot_user_id: Mapped[str] = mapped_column(String(100), nullable=False)
    webhook_secret: Mapped[str] = mapped_column(String(128), nullable=False)
    webhook_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    user: Mapped[UserModel] = relationship()


class ChannelAccountModel(Base):
    """Links an external IM account (e.g. Telegram user) to a HiAgent user."""

    __tablename__ = "channel_accounts"
    __table_args__ = (
        UniqueConstraint(
            "bot_config_id",
            "provider",
            "provider_user_id",
            name="uq_channel_account_provider_user",
        ),
        Index("ix_channel_accounts_bot_config_id", "bot_config_id"),
        Index("ix_channel_accounts_user_id", "user_id"),
        Index("ix_channel_accounts_provider_lookup", "provider", "provider_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    bot_config_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("telegram_bot_configs.id", ondelete="SET NULL"), nullable=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # "telegram"
    provider_user_id: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_chat_id: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active"
    )  # "active" / "unlinked"
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    user: Mapped[UserModel] = relationship()
    bot_config: Mapped[TelegramBotConfigModel | None] = relationship()
    sessions: Mapped[list[ChannelSessionModel]] = relationship(
        back_populates="channel_account", cascade="all, delete-orphan"
    )


class ChannelSessionModel(Base):
    """Maps an external chat (e.g. Telegram DM) to a HiAgent conversation."""

    __tablename__ = "channel_sessions"
    __table_args__ = (
        Index("ix_channel_sessions_account", "channel_account_id"),
        Index("ix_channel_sessions_bot_config", "bot_config_id"),
        Index("ix_channel_sessions_conversation", "conversation_id"),
        Index("ix_channel_sessions_provider_chat", "provider", "provider_chat_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    channel_account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("channel_accounts.id", ondelete="CASCADE"), nullable=False
    )
    bot_config_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("telegram_bot_configs.id", ondelete="SET NULL"), nullable=True
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_chat_id: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    channel_account: Mapped[ChannelAccountModel] = relationship(
        back_populates="sessions"
    )
    bot_config: Mapped[TelegramBotConfigModel | None] = relationship()
    conversation: Mapped[ConversationModel] = relationship()


class ChannelMessageLogModel(Base):
    """Logs inbound/outbound messages for idempotency and debugging."""

    __tablename__ = "channel_message_log"
    __table_args__ = (
        UniqueConstraint(
            "channel_session_id",
            "direction",
            "provider_message_id",
            name="uq_channel_msg_dedupe",
        ),
        Index("ix_channel_msg_log_session", "channel_session_id"),
        Index("ix_channel_msg_log_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("channel_sessions.id", ondelete="CASCADE"), nullable=False
    )
    direction: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # "inbound" / "outbound"
    provider_message_id: Mapped[str] = mapped_column(String(100), nullable=False)
    content_preview: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="delivered")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    conversation_event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    session: Mapped[ChannelSessionModel] = relationship()


class ChannelLinkTokenModel(Base):
    """Short-lived token for linking an external IM account to a HiAgent user."""

    __tablename__ = "channel_link_tokens"
    __table_args__ = (
        UniqueConstraint("token", name="uq_channel_link_token"),
        Index("ix_channel_link_tokens_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    user: Mapped[UserModel] = relationship()
