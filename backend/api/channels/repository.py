"""Repository for channel persistence — CRUD for all channel tables.

All methods receive an ``AsyncSession`` via dependency injection.
All returned records are frozen dataclasses from ``schemas.py``.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from agent.state.models import ConversationModel, MessageModel
from api.channels.models import (
    ChannelAccountModel,
    ChannelLinkTokenModel,
    ChannelMessageLogModel,
    ChannelSessionModel,
    TelegramBotConfigModel,
)
from api.channels.schemas import (
    ChannelAccountRecord,
    ChannelConversationRecord,
    ChannelLinkTokenRecord,
    ChannelMessageLogRecord,
    ChannelSessionRecord,
    TelegramBotConfigRecord,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Converters (ORM → frozen DTO)
# ---------------------------------------------------------------------------


def _to_bot_config(model: TelegramBotConfigModel) -> TelegramBotConfigRecord:
    return TelegramBotConfigRecord(
        id=model.id,
        user_id=model.user_id,
        bot_token=model.bot_token,
        bot_username=model.bot_username,
        bot_user_id=model.bot_user_id,
        webhook_secret=model.webhook_secret,
        webhook_status=model.webhook_status,
        last_error=model.last_error,
        last_verified_at=model.last_verified_at,
        enabled=model.enabled,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_account(model: ChannelAccountModel) -> ChannelAccountRecord:
    return ChannelAccountRecord(
        id=model.id,
        user_id=model.user_id,
        bot_config_id=model.bot_config_id,
        provider=model.provider,
        provider_user_id=model.provider_user_id,
        provider_chat_id=model.provider_chat_id,
        display_name=model.display_name,
        status=model.status,
        linked_at=model.linked_at,
        updated_at=model.updated_at,
    )


def _to_session(model: ChannelSessionModel) -> ChannelSessionRecord:
    return ChannelSessionRecord(
        id=model.id,
        channel_account_id=model.channel_account_id,
        bot_config_id=model.bot_config_id,
        conversation_id=model.conversation_id,
        provider=model.provider,
        provider_chat_id=model.provider_chat_id,
        is_active=model.is_active,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_message_log(model: ChannelMessageLogModel) -> ChannelMessageLogRecord:
    return ChannelMessageLogRecord(
        id=model.id,
        channel_session_id=model.channel_session_id,
        direction=model.direction,
        provider_message_id=model.provider_message_id,
        content_preview=model.content_preview,
        status=model.status,
        retry_count=model.retry_count,
        conversation_event_id=model.conversation_event_id,
        created_at=model.created_at,
    )


def _to_link_token(model: ChannelLinkTokenModel) -> ChannelLinkTokenRecord:
    return ChannelLinkTokenRecord(
        id=model.id,
        user_id=model.user_id,
        token=model.token,
        provider=model.provider,
        expires_at=model.expires_at,
        used=model.used,
        created_at=model.created_at,
    )


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


class ChannelRepository:
    """Async repository for channel persistence backed by PostgreSQL/SQLite."""

    # -- TelegramBotConfig --

    async def upsert_telegram_bot_config(
        self,
        session: AsyncSession,
        *,
        user_id: uuid.UUID,
        bot_token: str,
        bot_username: str,
        bot_user_id: str,
        webhook_secret: str,
        webhook_status: str = "pending",
        enabled: bool = True,
        last_error: str | None = None,
    ) -> TelegramBotConfigRecord:
        stmt = select(TelegramBotConfigModel).where(
            TelegramBotConfigModel.user_id == user_id
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()

        if model is None:
            model = TelegramBotConfigModel(
                id=uuid.uuid4(),
                user_id=user_id,
                bot_token=bot_token,
                bot_username=bot_username,
                bot_user_id=bot_user_id,
                webhook_secret=webhook_secret,
                webhook_status=webhook_status,
                last_error=last_error,
                last_verified_at=_utcnow(),
                enabled=enabled,
            )
            session.add(model)
        else:
            model.bot_token = bot_token
            model.bot_username = bot_username
            model.bot_user_id = bot_user_id
            model.webhook_secret = webhook_secret
            model.webhook_status = webhook_status
            model.last_error = last_error
            model.last_verified_at = _utcnow()
            model.enabled = enabled
            model.updated_at = _utcnow()

        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_bot_config(model)

    async def get_telegram_bot_config_for_user(
        self, session: AsyncSession, user_id: uuid.UUID
    ) -> TelegramBotConfigRecord | None:
        stmt = select(TelegramBotConfigModel).where(
            TelegramBotConfigModel.user_id == user_id
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_bot_config(model) if model else None

    async def get_telegram_bot_config_by_webhook_secret(
        self, session: AsyncSession, webhook_secret: str
    ) -> TelegramBotConfigRecord | None:
        stmt = select(TelegramBotConfigModel).where(
            TelegramBotConfigModel.webhook_secret == webhook_secret,
            TelegramBotConfigModel.enabled.is_(True),
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_bot_config(model) if model else None

    async def update_telegram_bot_config_status(
        self,
        session: AsyncSession,
        config_id: uuid.UUID,
        *,
        webhook_status: str,
        last_error: str | None = None,
        enabled: bool | None = None,
    ) -> TelegramBotConfigRecord | None:
        stmt = select(TelegramBotConfigModel).where(
            TelegramBotConfigModel.id == config_id
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return None

        model.webhook_status = webhook_status
        model.last_error = last_error
        if enabled is not None:
            model.enabled = enabled
        model.updated_at = _utcnow()

        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_bot_config(model)

    # -- ChannelAccount --

    async def find_account_by_provider(
        self,
        session: AsyncSession,
        provider: str,
        provider_user_id: str,
        bot_config_id: uuid.UUID | None = None,
    ) -> ChannelAccountRecord | None:
        """Look up a channel account by provider identity."""
        stmt = select(ChannelAccountModel).where(
            ChannelAccountModel.provider == provider,
            ChannelAccountModel.provider_user_id == provider_user_id,
            ChannelAccountModel.status == "active",
        )
        if bot_config_id is not None:
            stmt = stmt.where(ChannelAccountModel.bot_config_id == bot_config_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_account(model) if model else None

    async def find_account_by_user(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        provider: str,
    ) -> ChannelAccountRecord | None:
        """Look up a user's channel account for a given provider."""
        stmt = select(ChannelAccountModel).where(
            ChannelAccountModel.user_id == user_id,
            ChannelAccountModel.provider == provider,
            ChannelAccountModel.status == "active",
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_account(model) if model else None

    async def list_accounts_for_user(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
    ) -> list[ChannelAccountRecord]:
        """List all channel accounts for a user."""
        stmt = (
            select(ChannelAccountModel)
            .where(ChannelAccountModel.user_id == user_id)
            .order_by(ChannelAccountModel.linked_at.desc())
        )
        result = await session.execute(stmt)
        return [_to_account(m) for m in result.scalars().all()]

    async def create_account(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        provider: str,
        provider_user_id: str,
        provider_chat_id: str,
        display_name: str | None = None,
        bot_config_id: uuid.UUID | None = None,
    ) -> ChannelAccountRecord:
        """Create or relink a channel account for the same provider identity."""
        existing_stmt = select(ChannelAccountModel).where(
            ChannelAccountModel.provider == provider,
            ChannelAccountModel.provider_user_id == provider_user_id,
            ChannelAccountModel.bot_config_id == bot_config_id,
        )
        existing_result = await session.execute(existing_stmt)
        existing = existing_result.scalar_one_or_none()

        if existing is not None:
            existing.user_id = user_id
            existing.provider_chat_id = provider_chat_id
            existing.display_name = display_name
            existing.status = "active"
            existing.linked_at = _utcnow()
            existing.updated_at = _utcnow()
            await session.flush()
            await session.refresh(existing)
            await session.commit()
            return _to_account(existing)

        model = ChannelAccountModel(
            id=uuid.uuid4(),
            user_id=user_id,
            bot_config_id=bot_config_id,
            provider=provider,
            provider_user_id=provider_user_id,
            provider_chat_id=provider_chat_id,
            display_name=display_name,
            status="active",
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_account(model)

    async def unlink_account(
        self,
        session: AsyncSession,
        account_id: uuid.UUID,
    ) -> bool:
        """Mark a channel account as unlinked. Returns True if found."""
        stmt = (
            update(ChannelAccountModel)
            .where(ChannelAccountModel.id == account_id)
            .values(status="unlinked", updated_at=_utcnow())
        )
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0  # type: ignore[union-attr]

    # -- ChannelSession --

    async def find_active_session(
        self,
        session: AsyncSession,
        channel_account_id: uuid.UUID,
    ) -> ChannelSessionRecord | None:
        """Find the active session for a channel account."""
        stmt = (
            select(ChannelSessionModel)
            .where(
                ChannelSessionModel.channel_account_id == channel_account_id,
                ChannelSessionModel.is_active.is_(True),
            )
            .with_for_update()
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_session(model) if model else None

    async def create_session(
        self,
        session: AsyncSession,
        channel_account_id: uuid.UUID,
        conversation_id: uuid.UUID,
        provider: str,
        provider_chat_id: str,
        bot_config_id: uuid.UUID | None = None,
    ) -> ChannelSessionRecord:
        """Create a new channel session (deactivates previous active session)."""
        # Deactivate any existing active session for this account
        deactivate_stmt = (
            update(ChannelSessionModel)
            .where(
                ChannelSessionModel.channel_account_id == channel_account_id,
                ChannelSessionModel.is_active.is_(True),
            )
            .values(is_active=False, updated_at=_utcnow())
        )
        await session.execute(deactivate_stmt)

        model = ChannelSessionModel(
            id=uuid.uuid4(),
            channel_account_id=channel_account_id,
            bot_config_id=bot_config_id,
            conversation_id=conversation_id,
            provider=provider,
            provider_chat_id=provider_chat_id,
            is_active=True,
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_session(model)

    async def deactivate_session(
        self,
        session: AsyncSession,
        session_id: uuid.UUID,
    ) -> bool:
        """Deactivate a channel session. Returns True if found."""
        stmt = (
            update(ChannelSessionModel)
            .where(ChannelSessionModel.id == session_id)
            .values(is_active=False, updated_at=_utcnow())
        )
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0  # type: ignore[union-attr]

    # -- ChannelMessageLog --

    async def is_message_seen(
        self,
        session: AsyncSession,
        channel_session_id: uuid.UUID,
        direction: str,
        provider_message_id: str,
    ) -> bool:
        """Check if a message has already been logged (for dedupe)."""
        stmt = select(ChannelMessageLogModel.id).where(
            ChannelMessageLogModel.channel_session_id == channel_session_id,
            ChannelMessageLogModel.direction == direction,
            ChannelMessageLogModel.provider_message_id == provider_message_id,
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def log_message(
        self,
        session: AsyncSession,
        channel_session_id: uuid.UUID,
        direction: str,
        provider_message_id: str,
        content_preview: str | None = None,
        status: str = "delivered",
        conversation_event_id: int | None = None,
    ) -> ChannelMessageLogRecord:
        """Log an inbound or outbound channel message."""
        model = ChannelMessageLogModel(
            channel_session_id=channel_session_id,
            direction=direction,
            provider_message_id=provider_message_id,
            content_preview=content_preview[:500] if content_preview else None,
            status=status,
            conversation_event_id=conversation_event_id,
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_message_log(model)

    async def update_message_status(
        self,
        session: AsyncSession,
        log_id: int,
        status: str,
        retry_count: int | None = None,
    ) -> None:
        """Update delivery status and retry count for a logged message."""
        values: dict = {"status": status}
        if retry_count is not None:
            values["retry_count"] = retry_count
        stmt = (
            update(ChannelMessageLogModel)
            .where(ChannelMessageLogModel.id == log_id)
            .values(**values)
        )
        await session.execute(stmt)
        await session.commit()

    # -- ChannelLinkToken --

    async def create_link_token(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        provider: str,
        ttl_minutes: int = 10,
    ) -> ChannelLinkTokenRecord:
        """Generate a short-lived link token for account binding."""
        token = secrets.token_hex(16)  # 32-char hex string
        model = ChannelLinkTokenModel(
            id=uuid.uuid4(),
            user_id=user_id,
            token=token,
            provider=provider,
            expires_at=_utcnow() + timedelta(minutes=ttl_minutes),
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_link_token(model)

    async def list_channel_conversations(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
    ) -> list[ChannelConversationRecord]:
        """List conversations linked to channel sessions for a user.

        Results are ordered by conversation recency (most recently updated first).
        """
        stmt = (
            select(ChannelSessionModel, ChannelAccountModel, ConversationModel)
            .join(
                ChannelAccountModel,
                ChannelSessionModel.channel_account_id == ChannelAccountModel.id,
            )
            .join(
                ConversationModel,
                ChannelSessionModel.conversation_id == ConversationModel.id,
            )
            .where(ChannelAccountModel.user_id == user_id)
            .order_by(ConversationModel.updated_at.desc())
        )
        result = await session.execute(stmt)
        rows = result.all()

        records = []
        for channel_session, account, conversation in rows:
            # Fetch last message preview (most recent message for this conversation)
            msg_stmt = (
                select(MessageModel)
                .where(MessageModel.conversation_id == conversation.id)
                .order_by(MessageModel.created_at.desc())
                .limit(1)
            )
            msg_result = await session.execute(msg_stmt)
            last_msg = msg_result.scalar_one_or_none()

            last_message: str | None = None
            last_message_at = None
            if last_msg is not None:
                content = last_msg.content
                if isinstance(content, dict) and "text" in content:
                    last_message = str(content["text"])[:100]
                elif isinstance(content, dict):
                    last_message = str(next(iter(content.values()), ""))[:100]
                last_message_at = last_msg.created_at

            records.append(
                ChannelConversationRecord(
                    conversation_id=conversation.id,
                    provider=channel_session.provider,
                    display_name=account.display_name,
                    provider_chat_id=channel_session.provider_chat_id,
                    last_message=last_message,
                    last_message_at=last_message_at,
                    session_active=channel_session.is_active,
                )
            )

        return records

    async def consume_link_token(
        self,
        session: AsyncSession,
        token: str,
        provider: str,
    ) -> ChannelLinkTokenRecord | None:
        """Consume a link token if valid (not expired, not used). Returns None if invalid."""
        stmt = select(ChannelLinkTokenModel).where(
            ChannelLinkTokenModel.token == token,
            ChannelLinkTokenModel.provider == provider,
            ChannelLinkTokenModel.used.is_(False),
            ChannelLinkTokenModel.expires_at > _utcnow(),
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return None

        model.used = True
        await session.commit()
        await session.refresh(model)
        return _to_link_token(model)
