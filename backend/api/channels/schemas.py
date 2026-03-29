"""Frozen dataclass DTOs for the channel layer.

These are the public API of the channels module — returned by repository
methods and used at API boundaries. ORM models must never leak beyond
the repository.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class TelegramBotConfigRecord:
    """Read-only per-user Telegram bot configuration."""

    id: uuid.UUID
    user_id: uuid.UUID
    bot_token: str
    bot_username: str
    bot_user_id: str
    webhook_secret: str
    webhook_status: str
    last_error: str | None
    last_verified_at: datetime | None
    enabled: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ChannelAccountRecord:
    """Read-only channel account record."""

    id: uuid.UUID
    user_id: uuid.UUID
    bot_config_id: uuid.UUID | None
    provider: str
    provider_user_id: str
    provider_chat_id: str
    display_name: str | None
    status: str
    linked_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ChannelSessionRecord:
    """Read-only channel session record."""

    id: uuid.UUID
    channel_account_id: uuid.UUID
    bot_config_id: uuid.UUID | None
    conversation_id: uuid.UUID
    provider: str
    provider_chat_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ChannelMessageLogRecord:
    """Read-only channel message log entry."""

    id: int
    channel_session_id: uuid.UUID
    direction: str
    provider_message_id: str
    content_preview: str | None
    status: str
    retry_count: int
    conversation_event_id: int | None
    created_at: datetime


@dataclass(frozen=True)
class ChannelLinkTokenRecord:
    """Read-only channel link token record."""

    id: uuid.UUID
    user_id: uuid.UUID
    token: str
    provider: str
    expires_at: datetime
    used: bool
    created_at: datetime


@dataclass(frozen=True)
class ChannelConversationRecord:
    """Read-only record combining a channel session with its conversation metadata."""

    conversation_id: uuid.UUID
    provider: str
    display_name: str | None
    provider_chat_id: str
    last_message: str | None
    last_message_at: datetime | None
    session_active: bool


@dataclass(frozen=True)
class InboundMessage:
    """Normalized inbound message from any channel provider."""

    provider: str
    provider_user_id: str
    provider_chat_id: str
    provider_message_id: str
    text: str | None
    display_name: str | None
    # File attachment info (provider-specific file id for download)
    file_id: str | None = None
    file_name: str | None = None
    file_mime_type: str | None = None
    # Command detection
    is_command: bool = False
    command: str | None = None  # e.g. "start", "help", "new", "unlink"
    command_args: str | None = None  # e.g. the token after "/start"
