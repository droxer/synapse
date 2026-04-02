"""Channel responder — subscribes to agent events and sends outbound messages."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Callable

import httpx
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.artifacts.storage import StorageBackend
from api.channels.provider import ChannelProvider
from api.channels.repository import ChannelRepository
from api.events import AgentEvent, EventEmitter, EventType


def _read_file_bytes(path: str) -> bytes:
    with open(path, "rb") as f:  # noqa: WPS515
        return f.read()


FLUSH_INTERVAL_SECONDS = 2.0
FLUSH_BUFFER_THRESHOLD = 500
_MAX_MESSAGE_LENGTH = 4096
ASK_USER_TIMEOUT_SECONDS = 300


def _split_text(text: str, limit: int = _MAX_MESSAGE_LENGTH) -> list[str]:
    """Split *text* into chunks of at most *limit* characters."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    while text:
        chunks.append(text[:limit])
        text = text[limit:]
    return chunks


class ChannelResponder:
    """Translates agent events into outbound channel messages.

    Instantiate one per conversation turn and pass :pymethod:`__call__` as the
    ``EventEmitter`` subscriber callback.
    """

    def __init__(
        self,
        *,
        provider: ChannelProvider,
        chat_id: str,
        channel_repo: ChannelRepository,
        session_factory: async_sessionmaker[AsyncSession],
        channel_session_id: uuid.UUID,
        conversation_id: uuid.UUID,
        emitter: EventEmitter,
        storage_backend: StorageBackend | None = None,
        on_ask_user: Callable[[uuid.UUID, str, Any], None] | None = None,
    ) -> None:
        self._provider = provider
        self._chat_id = chat_id
        self._repo = channel_repo
        self._session_factory = session_factory
        self._channel_session_id = channel_session_id
        self._conversation_id = conversation_id
        self._emitter = emitter
        self._storage_backend = storage_backend
        self._on_ask_user = on_ask_user

        # Streaming buffer state
        self._buffer: list[str] = []
        self._buffer_len = 0
        self._flush_timer: asyncio.TimerHandle | None = None
        self._ask_user_timeout_task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # EventEmitter callback
    # ------------------------------------------------------------------

    async def __call__(self, event: AgentEvent) -> None:
        """Handle an incoming agent event."""
        etype = event.type
        data = event.data

        if etype == EventType.TEXT_DELTA:
            self._append_delta(data.get("text", ""))

        elif etype in (EventType.TURN_COMPLETE, EventType.TASK_COMPLETE):
            self._cancel_flush_timer()
            self._cancel_ask_user_timeout()
            buffered = "".join(self._buffer)
            self._discard_buffer()
            text_to_send = buffered or data.get("result", "")
            if text_to_send:
                await self._send_and_log(str(text_to_send))
            self._emitter.unsubscribe(self)

        elif etype == EventType.ASK_USER:
            self._cancel_flush_timer()
            self._discard_buffer()
            question = data.get("question") or data.get("message") or ""
            if question:
                await self._send_and_log(str(question))
            request_id = data.get("_request_id")
            response_callback = data.get("response_callback")
            if self._on_ask_user and request_id is not None:
                self._on_ask_user(
                    self._conversation_id, str(request_id), response_callback
                )
            self._ask_user_timeout_task = asyncio.create_task(self._ask_user_timeout())

        elif etype == EventType.ARTIFACT_CREATED:
            content_type: str = data.get("content_type", "")
            if self._storage_backend is not None:
                storage_key: str = data.get("storage_key", "")
                name: str = data.get("name", "file")
                if storage_key:
                    await self._send_artifact(storage_key, content_type, name)

        elif etype == EventType.TASK_ERROR:
            self._cancel_flush_timer()
            self._cancel_ask_user_timeout()
            self._discard_buffer()
            error = data.get("error", "An error occurred.")
            await self._send_and_log(f"Error: {error}")
            self._emitter.unsubscribe(self)

    # ------------------------------------------------------------------
    # Buffer management
    # ------------------------------------------------------------------

    def _append_delta(self, text: str) -> None:
        if not text:
            return
        self._buffer.append(text)
        self._buffer_len += len(text)

        if self._buffer_len >= FLUSH_BUFFER_THRESHOLD:
            asyncio.get_event_loop().create_task(self._flush_buffer())
        elif self._flush_timer is None:
            self._schedule_flush_timer()

    def _schedule_flush_timer(self) -> None:
        loop = asyncio.get_event_loop()
        self._flush_timer = loop.call_later(
            FLUSH_INTERVAL_SECONDS,
            lambda: loop.create_task(self._flush_buffer()),
        )

    def _cancel_flush_timer(self) -> None:
        if self._flush_timer is not None:
            self._flush_timer.cancel()
            self._flush_timer = None

    def _cancel_ask_user_timeout(self) -> None:
        if self._ask_user_timeout_task is not None:
            self._ask_user_timeout_task.cancel()
            self._ask_user_timeout_task = None

    async def _ask_user_timeout(self) -> None:
        """Unsubscribe and notify user if ask_user goes unanswered for too long."""
        await asyncio.sleep(ASK_USER_TIMEOUT_SECONDS)
        logger.warning(
            "channel_ask_user_timeout conversation_id={} chat_id={}",
            self._conversation_id,
            self._chat_id,
        )
        await self._send_and_log(
            "No response received. The conversation has timed out. "
            "Send a new message to continue."
        )
        self._emitter.unsubscribe(self)

    def _discard_buffer(self) -> None:
        self._buffer.clear()
        self._buffer_len = 0

    async def _flush_buffer(self) -> None:
        self._cancel_flush_timer()
        if not self._buffer:
            return
        text = "".join(self._buffer)
        self._buffer.clear()
        self._buffer_len = 0
        await self._send_and_log(text)

    # ------------------------------------------------------------------
    # Delivery
    # ------------------------------------------------------------------

    async def _send_artifact(
        self, storage_key: str, content_type: str, filename: str
    ) -> None:
        """Fetch an artifact from storage and send it as a file."""
        assert self._storage_backend is not None
        try:
            url_or_path = await self._storage_backend.get_url(
                storage_key, content_type, filename
            )
            if "://" in url_or_path:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url_or_path)
                    resp.raise_for_status()
                    file_data = resp.content
            else:
                file_data = await asyncio.to_thread(_read_file_bytes, url_or_path)
            await self._provider.send_file(self._chat_id, file_data, filename)
        except Exception:
            logger.warning(
                "channel_responder artifact send failed key={} chat_id={}",
                storage_key,
                self._chat_id,
            )

    async def _send_and_log(self, text: str) -> None:
        """Split, send, and log an outbound message."""
        chunks = _split_text(text)
        for chunk in chunks:
            await self._deliver_chunk(chunk)

    async def _deliver_chunk(self, text: str) -> None:
        """Send a single chunk via the provider and log the result."""
        provider_message_id: str | None = None
        status = "delivered"
        try:
            provider_message_id = await self._provider.send_text(self._chat_id, text)
        except Exception:
            logger.warning(
                "channel_responder delivery failed chat_id={} len={}",
                self._chat_id,
                len(text),
            )
            status = "failed"

        # Log outbound message
        try:
            async with self._session_factory() as session:
                await self._repo.log_message(
                    session,
                    channel_session_id=self._channel_session_id,
                    direction="outbound",
                    provider_message_id=provider_message_id or "",
                    content_preview=text[:500] if text else None,
                    status=status,
                )
        except Exception:
            logger.warning(
                "channel_responder failed to log outbound message chat_id={}",
                self._chat_id,
            )
