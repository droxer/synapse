"""Channel router — bridges inbound IM messages into the conversation engine.

Receives normalised ``InboundMessage`` objects from a channel provider,
resolves identity / session state, handles commands, and forwards regular
messages to the appropriate conversation.
"""

from __future__ import annotations

import uuid
from typing import Any

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.channels.provider import ChannelProvider
from api.channels.repository import ChannelRepository
from api.channels.schemas import ChannelAccountRecord, InboundMessage

_HELP_TEXT = (
    "Available commands:\n"
    "/start <token> — Link your account\n"
    "/new — Start a new conversation\n"
    "/help — Show this help message\n"
    "/unlink — Unlink your account"
)


class ChannelRouter:
    """Routes inbound channel messages to the conversation engine.

    Responsibilities:
    - Account resolution (provider + provider_user_id → ChannelAccount)
    - Command handling (/start, /help, /new, /unlink)
    - Session management (load or create ChannelSession → conversation_id)
    - Pending ``ask_user`` prompt fulfillment
    """

    def __init__(
        self,
        channel_repo: ChannelRepository,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self._repo = channel_repo
        self._session_factory = session_factory

        # conversation_id → (request_id, callback)
        self._pending_prompts: dict[uuid.UUID, tuple[str, Any]] = {}

    # ------------------------------------------------------------------
    # Public helpers for ask_user prompt lifecycle
    # ------------------------------------------------------------------

    def register_pending_prompt(
        self, conversation_id: uuid.UUID, request_id: str, callback: Any
    ) -> None:
        """Register a pending ``ask_user`` prompt for a conversation."""
        self._pending_prompts[conversation_id] = (request_id, callback)
        logger.debug(
            "Registered pending prompt for conversation={} request={}",
            conversation_id,
            request_id,
        )

    def has_pending_prompt(self, conversation_id: uuid.UUID) -> bool:
        """Return whether a conversation has a pending ``ask_user`` prompt."""
        return conversation_id in self._pending_prompts

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def handle_inbound(
        self,
        message: InboundMessage,
        provider: ChannelProvider,
        bot_config_id: uuid.UUID,
    ) -> None:
        """Route an inbound message — commands, linking, or conversation."""
        logger.info(
            "Inbound message provider={} user={} cmd={}",
            message.provider,
            message.provider_user_id,
            message.command,
        )

        async with self._session_factory() as db:
            account = await self._repo.find_account_by_provider(
                db,
                message.provider,
                message.provider_user_id,
                bot_config_id=bot_config_id,
            )

        # -- Command handling --------------------------------------------------
        if message.is_command:
            await self._handle_command(account, message, provider, bot_config_id)
            return

        # -- Guard: account must be linked for regular messages ----------------
        if account is None:
            await provider.send_text(
                message.provider_chat_id,
                "Your account is not linked. Use /start <token> to link it.",
            )
            return

        # -- Regular message ---------------------------------------------------
        await self._handle_regular_message(account, message)

    # ------------------------------------------------------------------
    # Command dispatcher
    # ------------------------------------------------------------------

    async def _handle_command(
        self,
        account: ChannelAccountRecord | None,
        message: InboundMessage,
        provider: ChannelProvider,
        bot_config_id: uuid.UUID,
    ) -> None:
        """Dispatch a recognised slash-command."""
        cmd = (message.command or "").lower()

        if cmd == "start":
            await self._handle_start_command(message, provider, bot_config_id)
            return

        if cmd == "help":
            await provider.send_text(message.provider_chat_id, _HELP_TEXT)
            return

        # Commands below require a linked account.
        if account is None:
            await provider.send_text(
                message.provider_chat_id,
                "Your account is not linked. Use /start <token> to link it.",
            )
            return

        if cmd == "new":
            await self._handle_new_command(account, message, provider)
            return

        if cmd == "unlink":
            await self._handle_unlink_command(account, message, provider)
            return

        # Unknown command — treat as a hint.
        await provider.send_text(
            message.provider_chat_id,
            f"Unknown command /{cmd}. Use /help to see available commands.",
        )

    # ------------------------------------------------------------------
    # /start <token>
    # ------------------------------------------------------------------

    async def _handle_start_command(
        self,
        message: InboundMessage,
        provider: ChannelProvider,
        bot_config_id: uuid.UUID,
    ) -> None:
        """Handle ``/start <token>`` for account linking."""
        token = (message.command_args or "").strip()
        if not token:
            await provider.send_text(
                message.provider_chat_id,
                "Usage: /start <token>\n\n"
                "Generate a link token from the HiAgent web dashboard.",
            )
            return

        async with self._session_factory() as db:
            link_record = await self._repo.consume_link_token(
                db, token, message.provider
            )

            if link_record is None:
                logger.warning(
                    "Invalid/expired link token from user={}",
                    message.provider_user_id,
                )
                await provider.send_text(
                    message.provider_chat_id,
                    "Invalid or expired link token. Please generate a new one.",
                )
                return

            existing = await self._repo.find_account_by_provider(
                db,
                message.provider,
                message.provider_user_id,
                bot_config_id=bot_config_id,
            )
            if existing is not None:
                await provider.send_text(
                    message.provider_chat_id,
                    "This account is already linked. Use /unlink first if you "
                    "want to re-link to a different user.",
                )
                return

            bot_config = await self._repo.get_telegram_bot_config_for_user(
                db, link_record.user_id
            )
            if bot_config is None or not bot_config.enabled:
                await provider.send_text(
                    message.provider_chat_id,
                    "This user has not enabled a Telegram bot yet. Finish setup in the Channels page first.",
                )
                return

            if bot_config.id != bot_config_id:
                await provider.send_text(
                    message.provider_chat_id,
                    "This link token belongs to a different Telegram bot. Open the bot configured in the Channels page and try again.",
                )
                return

            account = await self._repo.create_account(
                db,
                user_id=link_record.user_id,
                provider=message.provider,
                provider_user_id=message.provider_user_id,
                provider_chat_id=message.provider_chat_id,
                display_name=message.display_name,
                bot_config_id=bot_config.id,
            )

        logger.info(
            "Account linked: account={} user={} provider={}",
            account.id,
            account.user_id,
            account.provider,
        )
        await provider.send_text(
            message.provider_chat_id,
            "Account linked successfully! Send a message to start chatting.",
        )

    # ------------------------------------------------------------------
    # /new
    # ------------------------------------------------------------------

    async def _handle_new_command(
        self,
        account: ChannelAccountRecord,
        message: InboundMessage,
        provider: ChannelProvider,
    ) -> None:
        """Deactivate the current session so the next message creates a new conversation."""
        async with self._session_factory() as db:
            active_session = await self._repo.find_active_session(db, account.id)
            if active_session is not None:
                await self._repo.deactivate_session(db, active_session.id)
                logger.info(
                    "Deactivated session={} for account={}",
                    active_session.id,
                    account.id,
                )

        await provider.send_text(
            message.provider_chat_id,
            "Conversation ended. Send a new message to start a fresh conversation.",
        )

    # ------------------------------------------------------------------
    # /unlink
    # ------------------------------------------------------------------

    async def _handle_unlink_command(
        self,
        account: ChannelAccountRecord,
        message: InboundMessage,
        provider: ChannelProvider,
    ) -> None:
        """Unlink the channel account."""
        async with self._session_factory() as db:
            # Deactivate any open session first.
            active_session = await self._repo.find_active_session(db, account.id)
            if active_session is not None:
                await self._repo.deactivate_session(db, active_session.id)

            await self._repo.unlink_account(db, account.id)

        logger.info("Account unlinked: account={}", account.id)
        await provider.send_text(
            message.provider_chat_id,
            "Account unlinked. Use /start <token> to link again.",
        )

    # ------------------------------------------------------------------
    # Regular (non-command) messages
    # ------------------------------------------------------------------

    async def _handle_regular_message(
        self, account: ChannelAccountRecord, message: InboundMessage
    ) -> None:
        """Route a regular message to the conversation engine."""
        async with self._session_factory() as db:
            session_record = await self._repo.find_active_session(db, account.id)

            if session_record is None:
                # No active session — create a new conversation + session.
                conversation_id = uuid.uuid4()
                # TODO: bridge to conversation engine — create conversation
                # for account.user_id with conversation_id

                session_record = await self._repo.create_session(
                    db,
                    channel_account_id=account.id,
                    conversation_id=conversation_id,
                    provider=message.provider,
                    provider_chat_id=message.provider_chat_id,
                )
                logger.info(
                    "Created new session={} conversation={} for account={}",
                    session_record.id,
                    session_record.conversation_id,
                    account.id,
                )

            # Log the inbound message.
            await self._repo.log_message(
                db,
                channel_session_id=session_record.id,
                direction="inbound",
                provider_message_id=message.provider_message_id,
                content_preview=message.text,
            )

        # -- Check for a pending ask_user prompt ---------------------------
        conv_id = session_record.conversation_id
        if conv_id in self._pending_prompts:
            request_id, callback = self._pending_prompts.pop(conv_id)
            logger.info(
                "Fulfilling pending ask_user prompt request={} for conversation={}",
                request_id,
                conv_id,
            )
            # TODO: bridge to conversation engine — fulfill ask_user callback
            # with message.text and request_id
            return

        # -- Forward as a new user message ---------------------------------
        logger.info(
            "Forwarding message to conversation={} session={}",
            conv_id,
            session_record.id,
        )
        # TODO: bridge to conversation engine — send user message
        # to conversation conv_id for account.user_id
