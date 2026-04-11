"""Tests for desktop OAuth nonce handoff storage/consume flow."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api.routes import auth


class _FakeRedis:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        del ex
        self._store[key] = value

    async def getdel(self, key: str) -> str | None:
        return self._store.pop(key, None)

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_desktop_token_round_trip_single_use(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeRedis()

    async def _fake_open_redis() -> _FakeRedis:
        return fake

    monkeypatch.setattr(auth, "_open_redis", _fake_open_redis)

    req = auth.DesktopTokenStoreRequest(
        nonce="0123456789ABCDEF0123456789ABCDEF",
        email="user@example.com",
        name="Test User",
        image="https://example.com/u.png",
        googleId="gid-1",
    )
    await auth.store_desktop_token(req)

    first = await auth.consume_desktop_token(req.nonce)
    assert first["status"] == "complete"
    assert first["user"]["email"] == "user@example.com"

    with pytest.raises(HTTPException) as second_err:
        await auth.consume_desktop_token(req.nonce)
    assert second_err.value.status_code == 404


def test_store_request_validation_rejects_bad_nonce() -> None:
    with pytest.raises(ValidationError):
        auth.DesktopTokenStoreRequest(
            nonce="bad nonce",
            email="user@example.com",
            name="x",
            image="x",
            googleId="x",
        )


@pytest.mark.asyncio
async def test_consume_rejects_invalid_nonce() -> None:
    with pytest.raises(HTTPException) as err:
        await auth.consume_desktop_token("bad nonce")
    assert err.value.status_code == 400


@pytest.mark.asyncio
async def test_consume_invalid_payload_returns_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeRedis()
    fake._store[auth._desktop_nonce_key("0123456789ABCDEF0123456789ABCDEF")] = (
        json.dumps(
            {"email": ""},
        )
    )

    async def _fake_open_redis() -> _FakeRedis:
        return fake

    monkeypatch.setattr(auth, "_open_redis", _fake_open_redis)

    with pytest.raises(HTTPException) as err:
        await auth.consume_desktop_token("0123456789ABCDEF0123456789ABCDEF")
    assert err.value.status_code == 404
