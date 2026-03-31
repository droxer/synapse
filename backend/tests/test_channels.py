"""Tests for the channel system — repository, provider, and schemas.

Covers ChannelRepository (DB CRUD), TelegramProvider (parse/verify),
and InboundMessage defaults.
"""

import hashlib
import hmac as hmac_mod
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

import api.channels.models  # noqa: F401  — register channel ORM models with Base
from agent.state.models import ConversationModel, UserModel
from api.channels.provider import TelegramProvider
from api.channels.repository import ChannelRepository
from api.channels.router import ChannelRouter
from api.channels.schemas import InboundMessage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_user(session: AsyncSession) -> UserModel:
    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@test.com",
        name="Test User",
    )
    session.add(user)
    await session.flush()
    return user


async def _make_conversation(
    session: AsyncSession, user: UserModel
) -> ConversationModel:
    convo = ConversationModel(
        id=uuid.uuid4(),
        user_id=user.id,
        title="Test Conversation",
    )
    session.add(convo)
    await session.flush()
    return convo


# ---------------------------------------------------------------------------
# Repository tests
# ---------------------------------------------------------------------------


@pytest.fixture
def repo() -> ChannelRepository:
    return ChannelRepository()


class TestChannelAccountCRUD:
    """Tests for account create / find / unlink."""

    @pytest.mark.asyncio
    async def test_create_and_find_account(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        account = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_111",
            provider_chat_id="chat_111",
            display_name="Alice",
        )
        assert account.provider == "telegram"
        assert account.provider_user_id == "tg_111"
        assert account.display_name == "Alice"
        assert account.status == "active"

        found = await repo.find_account_by_provider(session, "telegram", "tg_111")
        assert found is not None
        assert found.id == account.id

    @pytest.mark.asyncio
    async def test_find_account_by_user(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        account = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_222",
            provider_chat_id="chat_222",
        )

        found = await repo.find_account_by_user(session, user.id, "telegram")
        assert found is not None
        assert found.id == account.id

        # Different provider → None
        not_found = await repo.find_account_by_user(session, user.id, "slack")
        assert not_found is None

    @pytest.mark.asyncio
    async def test_unlink_account(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        account = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_333",
            provider_chat_id="chat_333",
        )

        result = await repo.unlink_account(session, account.id)
        assert result is True

        # find_account_by_provider filters on status == "active", so should be None
        found = await repo.find_account_by_provider(session, "telegram", "tg_333")
        assert found is None

    @pytest.mark.asyncio
    async def test_relink_unlinked_account_reuses_existing_row(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        bot_config = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:ABC",
            bot_username="relink_bot",
            bot_user_id="700100",
            webhook_secret="relink-secret",
            webhook_status="active",
        )

        first = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_relink_1",
            provider_chat_id="chat_old",
            display_name="Old Name",
            bot_config_id=bot_config.id,
        )

        await repo.unlink_account(session, first.id)

        relinked = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_relink_1",
            provider_chat_id="chat_new",
            display_name="New Name",
            bot_config_id=bot_config.id,
        )

        assert relinked.id == first.id
        assert relinked.status == "active"
        assert relinked.provider_chat_id == "chat_new"
        assert relinked.display_name == "New Name"


class TestChannelSession:
    """Tests for session create / find / deactivation."""

    @pytest.mark.asyncio
    async def test_create_and_find_session(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        convo = await _make_conversation(session, user)
        account = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_400",
            provider_chat_id="chat_400",
        )

        cs = await repo.create_session(
            session,
            channel_account_id=account.id,
            conversation_id=convo.id,
            provider="telegram",
            provider_chat_id="chat_400",
        )
        assert cs.is_active is True
        assert cs.channel_account_id == account.id
        assert cs.conversation_id == convo.id

        active = await repo.find_active_session(session, account.id)
        assert active is not None
        assert active.id == cs.id

    @pytest.mark.asyncio
    async def test_create_session_deactivates_previous(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        convo1 = await _make_conversation(session, user)
        convo2 = await _make_conversation(session, user)
        account = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_500",
            provider_chat_id="chat_500",
        )

        first = await repo.create_session(
            session,
            channel_account_id=account.id,
            conversation_id=convo1.id,
            provider="telegram",
            provider_chat_id="chat_500",
        )
        assert first.is_active is True

        second = await repo.create_session(
            session,
            channel_account_id=account.id,
            conversation_id=convo2.id,
            provider="telegram",
            provider_chat_id="chat_500",
        )
        assert second.is_active is True

        # The only active session should be the second one
        active = await repo.find_active_session(session, account.id)
        assert active is not None
        assert active.id == second.id
        assert active.id != first.id


class TestMessageDedup:
    """Tests for message logging and deduplication."""

    @pytest.mark.asyncio
    async def test_message_dedup(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        convo = await _make_conversation(session, user)
        account = await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_600",
            provider_chat_id="chat_600",
        )
        cs = await repo.create_session(
            session,
            channel_account_id=account.id,
            conversation_id=convo.id,
            provider="telegram",
            provider_chat_id="chat_600",
        )

        # Not seen yet
        seen_before = await repo.is_message_seen(session, cs.id, "inbound", "msg_001")
        assert seen_before is False

        # Log the message
        log = await repo.log_message(
            session,
            channel_session_id=cs.id,
            direction="inbound",
            provider_message_id="msg_001",
            content_preview="Hello!",
        )
        assert log.direction == "inbound"
        assert log.provider_message_id == "msg_001"
        assert log.content_preview == "Hello!"
        assert log.status == "delivered"

        # Now it should be seen
        seen_after = await repo.is_message_seen(session, cs.id, "inbound", "msg_001")
        assert seen_after is True


class TestLinkToken:
    """Tests for link-token create / consume / expiry."""

    @pytest.mark.asyncio
    async def test_create_and_consume_link_token(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        token_rec = await repo.create_link_token(
            session, user_id=user.id, provider="telegram", ttl_minutes=10
        )
        assert token_rec.used is False
        assert token_rec.provider == "telegram"
        assert len(token_rec.token) == 32  # secrets.token_hex(16) → 32-char hex

        consumed = await repo.consume_link_token(
            session, token=token_rec.token, provider="telegram"
        )
        assert consumed is not None
        assert consumed.used is True
        assert consumed.id == token_rec.id

    @pytest.mark.asyncio
    async def test_consume_expired_token(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        # ttl_minutes=0 means expires_at ≈ now, which is immediately expired
        token_rec = await repo.create_link_token(
            session, user_id=user.id, provider="telegram", ttl_minutes=0
        )

        consumed = await repo.consume_link_token(
            session, token=token_rec.token, provider="telegram"
        )
        assert consumed is None

    @pytest.mark.asyncio
    async def test_consume_used_token(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        token_rec = await repo.create_link_token(
            session, user_id=user.id, provider="telegram", ttl_minutes=10
        )

        first = await repo.consume_link_token(
            session, token=token_rec.token, provider="telegram"
        )
        assert first is not None

        # Second consume of the same token → None
        second = await repo.consume_link_token(
            session, token=token_rec.token, provider="telegram"
        )
        assert second is None


class TestTelegramBotConfig:
    """Tests for per-user Telegram bot configuration persistence."""

    @pytest.mark.asyncio
    async def test_upsert_and_find_bot_config(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)

        config = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:ABC",
            bot_username="my_test_bot",
            bot_user_id="777000",
            webhook_secret="secret-1",
            webhook_status="active",
        )

        assert config.user_id == user.id
        assert config.bot_username == "my_test_bot"
        assert config.bot_user_id == "777000"
        assert config.webhook_secret == "secret-1"
        assert config.webhook_status == "active"
        assert config.enabled is True

        found = await repo.get_telegram_bot_config_for_user(session, user.id)
        assert found is not None
        assert found.id == config.id
        assert found.bot_token == "123456:ABC"

    @pytest.mark.asyncio
    async def test_find_bot_config_by_webhook_secret(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        config = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:ABC",
            bot_username="my_test_bot",
            bot_user_id="777001",
            webhook_secret="secret-lookup",
        )

        found = await repo.get_telegram_bot_config_by_webhook_secret(
            session, "secret-lookup"
        )
        assert found is not None
        assert found.id == config.id

    @pytest.mark.asyncio
    async def test_upsert_replaces_existing_bot_config(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        first = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:OLD",
            bot_username="old_bot",
            bot_user_id="700001",
            webhook_secret="secret-old",
            webhook_status="pending",
        )

        second = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:NEW",
            bot_username="new_bot",
            bot_user_id="700002",
            webhook_secret="secret-new",
            webhook_status="active",
        )

        assert second.id == first.id
        assert second.bot_username == "new_bot"
        assert second.bot_user_id == "700002"
        assert second.webhook_secret == "secret-new"

    @pytest.mark.asyncio
    async def test_update_bot_config_status(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        config = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:ABC",
            bot_username="status_bot",
            bot_user_id="700003",
            webhook_secret="secret-status",
        )

        updated = await repo.update_telegram_bot_config_status(
            session,
            config.id,
            webhook_status="error",
            last_error="setWebhook failed",
            enabled=False,
        )

        assert updated is not None
        assert updated.webhook_status == "error"
        assert updated.last_error == "setWebhook failed"
        assert updated.enabled is False


# ---------------------------------------------------------------------------
# TelegramProvider tests (no network)
# ---------------------------------------------------------------------------

BOT_TOKEN = "123456:ABC"
WEBHOOK_SECRET = "test_secret"


@pytest.fixture
def tg() -> TelegramProvider:
    with patch("api.channels.provider.httpx.AsyncClient", return_value=MagicMock()):
        return TelegramProvider(bot_token=BOT_TOKEN, webhook_secret=WEBHOOK_SECRET)


class TestTelegramParseInbound:
    """parse_inbound extracts fields from Telegram Update payloads."""

    @pytest.mark.asyncio
    async def test_parse_inbound_text_message(self, tg: TelegramProvider) -> None:
        payload = {
            "update_id": 1,
            "message": {
                "message_id": 42,
                "from": {"id": 999, "first_name": "Bob"},
                "chat": {"id": 999},
                "text": "Hello bot!",
            },
        }
        msg = await tg.parse_inbound(payload)
        assert msg is not None
        assert msg.provider == "telegram"
        assert msg.provider_user_id == "999"
        assert msg.provider_chat_id == "999"
        assert msg.provider_message_id == "42"
        assert msg.text == "Hello bot!"
        assert msg.display_name == "Bob"
        assert msg.is_command is False
        assert msg.command is None
        assert msg.command_args is None
        assert msg.file_id is None

    @pytest.mark.asyncio
    async def test_parse_inbound_command(self, tg: TelegramProvider) -> None:
        payload = {
            "update_id": 2,
            "message": {
                "message_id": 43,
                "from": {"id": 999, "first_name": "Bob"},
                "chat": {"id": 999},
                "text": "/start abc123",
            },
        }
        msg = await tg.parse_inbound(payload)
        assert msg is not None
        assert msg.is_command is True
        assert msg.command == "start"
        assert msg.command_args == "abc123"

    @pytest.mark.asyncio
    async def test_parse_inbound_command_with_bot_mention(
        self, tg: TelegramProvider
    ) -> None:
        """Commands like /start@MyBot should strip the @mention suffix."""
        payload = {
            "update_id": 3,
            "message": {
                "message_id": 44,
                "from": {"id": 999, "first_name": "Bob"},
                "chat": {"id": 999},
                "text": "/help@MyBot",
            },
        }
        msg = await tg.parse_inbound(payload)
        assert msg is not None
        assert msg.is_command is True
        assert msg.command == "help"
        assert msg.command_args is None

    @pytest.mark.asyncio
    async def test_parse_inbound_document(self, tg: TelegramProvider) -> None:
        payload = {
            "update_id": 4,
            "message": {
                "message_id": 45,
                "from": {"id": 999, "first_name": "Bob"},
                "chat": {"id": 999},
                "document": {
                    "file_id": "BQACAgIAA...",
                    "file_name": "report.pdf",
                    "mime_type": "application/pdf",
                },
                "caption": "Here is my report",
            },
        }
        msg = await tg.parse_inbound(payload)
        assert msg is not None
        assert msg.file_id == "BQACAgIAA..."
        assert msg.file_name == "report.pdf"
        assert msg.file_mime_type == "application/pdf"
        # text is None in the payload, so caption is used as fallback
        assert msg.text == "Here is my report"

    @pytest.mark.asyncio
    async def test_parse_inbound_photo(self, tg: TelegramProvider) -> None:
        payload = {
            "update_id": 5,
            "message": {
                "message_id": 46,
                "from": {"id": 999, "first_name": "Bob"},
                "chat": {"id": 999},
                "photo": [
                    {"file_id": "small_id", "width": 90, "height": 90},
                    {"file_id": "medium_id", "width": 320, "height": 320},
                    {"file_id": "large_id", "width": 800, "height": 800},
                ],
                "caption": "Nice photo",
            },
        }
        msg = await tg.parse_inbound(payload)
        assert msg is not None
        # Should pick the largest (last) photo
        assert msg.file_id == "large_id"
        assert msg.file_name == "photo.jpg"
        assert msg.file_mime_type == "image/jpeg"
        assert msg.text == "Nice photo"

    @pytest.mark.asyncio
    async def test_parse_inbound_no_message(self, tg: TelegramProvider) -> None:
        """Updates without a 'message' field (e.g. callback_query) → None."""
        payload = {
            "update_id": 6,
            "callback_query": {"id": "cb_1", "data": "clicked"},
        }
        msg = await tg.parse_inbound(payload)
        assert msg is None


class TestTelegramVerifyWebhook:
    """Webhook signature verification using HMAC-SHA256."""

    @pytest.mark.asyncio
    async def test_verify_webhook_valid(self, tg: TelegramProvider) -> None:
        body = b'{"update_id":1}'
        key = hashlib.sha256(BOT_TOKEN.encode()).digest()
        signature = hmac_mod.new(key, body, hashlib.sha256).hexdigest()

        assert await tg.verify_webhook(body, signature) is True

    @pytest.mark.asyncio
    async def test_verify_webhook_invalid(self, tg: TelegramProvider) -> None:
        body = b'{"update_id":1}'
        assert await tg.verify_webhook(body, "bad_signature") is False

    @pytest.mark.asyncio
    async def test_verify_webhook_tampered_body(self, tg: TelegramProvider) -> None:
        """A valid signature for a different body must fail."""
        original_body = b'{"update_id":1}'
        key = hashlib.sha256(BOT_TOKEN.encode()).digest()
        signature = hmac_mod.new(key, original_body, hashlib.sha256).hexdigest()

        tampered_body = b'{"update_id":2}'
        assert await tg.verify_webhook(tampered_body, signature) is False


class TestTelegramBotApiHelpers:
    @pytest.mark.asyncio
    async def test_get_me(self) -> None:
        client = AsyncMock()
        response = MagicMock()
        response.json.return_value = {
            "ok": True,
            "result": {"id": 123456, "username": "my_test_bot"},
        }
        response.raise_for_status.return_value = None
        client.get.return_value = response

        with patch("api.channels.provider.httpx.AsyncClient", return_value=client):
            tg = TelegramProvider(bot_token=BOT_TOKEN, webhook_secret=WEBHOOK_SECRET)

        profile = await tg.get_me()

        assert profile == {"bot_user_id": "123456", "bot_username": "my_test_bot"}
        client.get.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_set_webhook(self) -> None:
        client = AsyncMock()
        response = MagicMock()
        response.json.return_value = {"ok": True, "result": True}
        response.raise_for_status.return_value = None
        client.post.return_value = response

        with patch("api.channels.provider.httpx.AsyncClient", return_value=client):
            tg = TelegramProvider(bot_token=BOT_TOKEN, webhook_secret=WEBHOOK_SECRET)

        await tg.set_webhook(
            "https://example.com/channels/telegram/webhook", "secret-123"
        )

        _, kwargs = client.post.await_args
        assert kwargs["json"]["secret_token"] == "secret-123"
        assert kwargs["json"]["url"] == "https://example.com/channels/telegram/webhook"

    @pytest.mark.asyncio
    async def test_delete_webhook(self) -> None:
        client = AsyncMock()
        response = MagicMock()
        response.json.return_value = {"ok": True, "result": True}
        response.raise_for_status.return_value = None
        client.post.return_value = response

        with patch("api.channels.provider.httpx.AsyncClient", return_value=client):
            tg = TelegramProvider(bot_token=BOT_TOKEN, webhook_secret=WEBHOOK_SECRET)

        await tg.delete_webhook()

        client.post.assert_awaited_once()


# ---------------------------------------------------------------------------
# InboundMessage schema tests
# ---------------------------------------------------------------------------


class TestInboundMessageDefaults:
    def test_inbound_message_defaults(self) -> None:
        msg = InboundMessage(
            provider="telegram",
            provider_user_id="123",
            provider_chat_id="456",
            provider_message_id="789",
            text="hello",
            display_name="Test",
        )
        assert msg.file_id is None
        assert msg.file_name is None
        assert msg.file_mime_type is None
        assert msg.is_command is False
        assert msg.command is None
        assert msg.command_args is None

    def test_inbound_message_is_frozen(self) -> None:
        msg = InboundMessage(
            provider="telegram",
            provider_user_id="123",
            provider_chat_id="456",
            provider_message_id="789",
            text="hello",
            display_name="Test",
        )
        with pytest.raises(AttributeError):
            msg.text = "changed"  # type: ignore[misc]


class _StubProvider:
    provider_name = "telegram"

    def __init__(self) -> None:
        self.messages: list[str] = []

    async def send_text(
        self, chat_id: str, text: str, reply_to: str | None = None
    ) -> str:
        self.messages.append(text)
        return "stub-msg-id"


class TestChannelRouterStartCommand:
    @pytest.mark.asyncio
    async def test_start_when_already_linked_reports_already_linked(
        self, repo: ChannelRepository, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        bot_config = await repo.upsert_telegram_bot_config(
            session,
            user_id=user.id,
            bot_token="123456:ABC",
            bot_username="router_bot",
            bot_user_id="800001",
            webhook_secret="router-secret",
            webhook_status="active",
        )
        await repo.create_account(
            session,
            user_id=user.id,
            provider="telegram",
            provider_user_id="tg_router_1",
            provider_chat_id="chat_router_1",
            display_name="Router User",
            bot_config_id=bot_config.id,
        )

        session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
        router = ChannelRouter(channel_repo=repo, session_factory=session_factory)
        provider = _StubProvider()

        msg = InboundMessage(
            provider="telegram",
            provider_user_id="tg_router_1",
            provider_chat_id="chat_router_1",
            provider_message_id="m_router_1",
            text="/start definitely_invalid_token",
            display_name="Router User",
            is_command=True,
            command="start",
            command_args="definitely_invalid_token",
        )

        await router.handle_inbound(msg, provider, bot_config.id)

        assert provider.messages
        assert "already linked" in provider.messages[-1].lower()
