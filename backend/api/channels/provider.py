"""Channel provider protocol and Telegram implementation."""

from __future__ import annotations

import hashlib
import hmac
import mimetypes
from typing import Protocol, runtime_checkable

import httpx
from loguru import logger

from api.channels.schemas import InboundMessage

TELEGRAM_MAX_MESSAGE_LENGTH = 4096


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ChannelProvider(Protocol):
    """Interface that every channel provider must satisfy."""

    @property
    def provider_name(self) -> str: ...

    async def verify_webhook(self, request_body: bytes, signature: str) -> bool: ...

    async def parse_inbound(self, payload: dict) -> InboundMessage | None: ...

    async def send_text(
        self, chat_id: str, text: str, reply_to: str | None = None
    ) -> str: ...

    async def send_file(
        self,
        chat_id: str,
        file_data: bytes,
        filename: str,
        caption: str | None = None,
    ) -> str: ...

    async def download_file(self, file_id: str) -> tuple[bytes, str, str]: ...

    async def get_me(self) -> dict[str, str]: ...

    async def set_webhook(self, url: str, secret: str) -> None: ...

    async def delete_webhook(self) -> None: ...


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------


class TelegramProvider:
    """Telegram Bot API channel provider."""

    def __init__(self, bot_token: str, webhook_secret: str) -> None:
        self._token = bot_token
        self._webhook_secret = webhook_secret
        self._base_url = f"https://api.telegram.org/bot{bot_token}/"
        self._file_url = f"https://api.telegram.org/file/bot{bot_token}/"
        self._client = httpx.AsyncClient(timeout=30)

    # -- Protocol properties / helpers ------------------------------------

    @property
    def provider_name(self) -> str:
        return "telegram"

    def _hmac_key(self) -> bytes:
        """SHA-256 hash of the bot token, used as HMAC key."""
        return hashlib.sha256(self._token.encode()).digest()

    def _require_ok(self, resp: httpx.Response) -> dict:
        """Raise when Telegram returns an application-level error."""
        payload = resp.json()
        if payload.get("ok") is not True:
            description = payload.get("description") or "Telegram API request failed"
            raise RuntimeError(description)
        return payload

    # -- Webhook verification ---------------------------------------------

    async def verify_webhook(self, request_body: bytes, signature: str) -> bool:
        expected = hmac.new(self._hmac_key(), request_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    # -- Inbound parsing ---------------------------------------------------

    async def parse_inbound(self, payload: dict) -> InboundMessage | None:
        msg = payload.get("message")
        if msg is None:
            logger.debug("Telegram update has no 'message' field, skipping")
            return None

        chat_id = str(msg["chat"]["id"])
        from_user = msg.get("from", {})
        user_id = str(from_user.get("id", ""))
        display_name = from_user.get("first_name")
        message_id = str(msg["message_id"])
        text: str | None = msg.get("text")

        # -- Command detection --
        is_command = False
        command: str | None = None
        command_args: str | None = None
        if text and text.startswith("/"):
            is_command = True
            parts = text.split(maxsplit=1)
            # Strip bot mention suffix (e.g. /start@MyBot)
            command = parts[0][1:].split("@")[0]
            command_args = parts[1] if len(parts) > 1 else None

        # -- Attachment detection --
        file_id: str | None = None
        file_name: str | None = None
        file_mime: str | None = None

        if doc := msg.get("document"):
            file_id = doc["file_id"]
            file_name = doc.get("file_name")
            file_mime = doc.get("mime_type")
        elif photos := msg.get("photo"):
            # Largest photo is the last element in the array
            best = photos[-1]
            file_id = best["file_id"]
            file_name = "photo.jpg"
            file_mime = "image/jpeg"

        # Use caption as text fallback when a document/photo has no text
        if text is None and (msg.get("document") or msg.get("photo")):
            text = msg.get("caption")

        return InboundMessage(
            provider="telegram",
            provider_user_id=user_id,
            provider_chat_id=chat_id,
            provider_message_id=message_id,
            text=text,
            display_name=display_name,
            file_id=file_id,
            file_name=file_name,
            file_mime_type=file_mime,
            is_command=is_command,
            command=command,
            command_args=command_args,
        )

    # -- Sending -----------------------------------------------------------

    async def send_text(
        self, chat_id: str, text: str, reply_to: str | None = None
    ) -> str:
        last_id = ""
        chunks = _split_text(text, TELEGRAM_MAX_MESSAGE_LENGTH)
        for chunk in chunks:
            body: dict = {"chat_id": chat_id, "text": chunk}
            if reply_to is not None:
                body["reply_to_message_id"] = reply_to
                reply_to = None  # only first chunk replies
            resp = await self._client.post(f"{self._base_url}sendMessage", json=body)
            resp.raise_for_status()
            payload = self._require_ok(resp)
            last_id = str(payload["result"]["message_id"])
        return last_id

    async def send_file(
        self,
        chat_id: str,
        file_data: bytes,
        filename: str,
        caption: str | None = None,
    ) -> str:
        data: dict = {"chat_id": chat_id}
        if caption:
            data["caption"] = caption
        files = {"document": (filename, file_data)}
        resp = await self._client.post(
            f"{self._base_url}sendDocument", data=data, files=files
        )
        resp.raise_for_status()
        payload = self._require_ok(resp)
        return str(payload["result"]["message_id"])

    # -- File download -----------------------------------------------------

    async def download_file(self, file_id: str) -> tuple[bytes, str, str]:
        # Step 1: resolve file_id → file_path via getFile
        resp = await self._client.get(
            f"{self._base_url}getFile", params={"file_id": file_id}
        )
        resp.raise_for_status()
        payload = self._require_ok(resp)
        file_path: str = payload["result"]["file_path"]

        # Step 2: download the actual bytes
        dl_resp = await self._client.get(f"{self._file_url}{file_path}")
        dl_resp.raise_for_status()

        filename = file_path.rsplit("/", maxsplit=1)[-1]
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return dl_resp.content, filename, mime_type

    async def get_me(self) -> dict[str, str]:
        resp = await self._client.get(f"{self._base_url}getMe")
        resp.raise_for_status()
        payload = self._require_ok(resp)["result"]
        return {
            "bot_user_id": str(payload["id"]),
            "bot_username": str(payload["username"]),
        }

    async def set_webhook(self, url: str, secret: str) -> None:
        resp = await self._client.post(
            f"{self._base_url}setWebhook",
            json={"url": url, "secret_token": secret},
        )
        resp.raise_for_status()
        self._require_ok(resp)

    async def delete_webhook(self) -> None:
        resp = await self._client.post(f"{self._base_url}deleteWebhook")
        resp.raise_for_status()
        self._require_ok(resp)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _split_text(text: str, limit: int) -> list[str]:
    """Split *text* into chunks of at most *limit* characters."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    while text:
        chunks.append(text[:limit])
        text = text[limit:]
    return chunks
