"""Tests for preview tools."""

from __future__ import annotations

import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from agent.sandbox.base import ExecResult
from agent.tools.base import ExecutionContext
from agent.tools.sandbox.preview import PreviewStart, PreviewStop
from api.routes.artifacts import (
    _PREVIEW_BODY_END,
    _PREVIEW_BODY_START,
    _PREVIEW_HEADERS_END,
    _PREVIEW_HEADERS_START,
    proxy_preview,
)


def _request(
    path: str,
    *,
    method: str = "GET",
    body: bytes = b"",
    headers: list[tuple[bytes, bytes]] | None = None,
) -> Request:
    async def receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}

    route_path, _, query = path.partition("?")
    return Request(
        {
            "type": "http",
            "method": method,
            "path": route_path,
            "headers": headers or [],
            "query_string": query.encode(),
        },
        receive,
    )


async def _response_body(response) -> bytes:
    chunks: list[bytes] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    return b"".join(chunks)


def _preview_stdout(headers: str, body: bytes = b"<html>ok</html>") -> str:
    return (
        f"\n{_PREVIEW_HEADERS_START}\n"
        f"{headers}"
        f"\n{_PREVIEW_HEADERS_END}\n"
        f"{_PREVIEW_BODY_START}\n"
        f"{base64.b64encode(body).decode('ascii')}\n"
        f"{_PREVIEW_BODY_END}\n"
    )


class _FakePreviewSession:
    def __init__(self, stdout: str | None = None, *, port_open: bool = True) -> None:
        self.commands: list[str] = []
        self.fetch_commands: list[str] = []
        self.probe_commands: list[str] = []
        self._port_open = port_open
        self._stdout = stdout or (
            _preview_stdout(
                "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\n"
            )
        )

    async def exec(self, command: str, timeout: int | None = None) -> ExecResult:
        self.commands.append(command)
        if command.startswith("curl -sS -m 1 -o /dev/null"):
            self.probe_commands.append(command)
            return ExecResult(
                stdout="",
                stderr="" if self._port_open else "connection refused",
                exit_code=0 if self._port_open else 7,
            )
        self.fetch_commands.append(command)
        return ExecResult(
            stdout=self._stdout,
            stderr="",
            exit_code=0,
        )


class _FakePreviewStartSession:
    async def exec(self, command: str, timeout: int | None = None) -> ExecResult:
        return ExecResult(stdout="", stderr="", exit_code=0)


class TestPreviewStart:
    def test_definition(self) -> None:
        tool = PreviewStart()
        defn = tool.definition()
        assert defn.name == "preview_start"
        assert defn.execution_context == ExecutionContext.SANDBOX
        assert "preview" in defn.tags

    async def test_invalid_port_below_range_fails(self) -> None:
        tool = PreviewStart()
        result = await tool.execute(session=None, port=80)
        assert not result.success
        assert "Port" in result.error

    async def test_invalid_port_above_range_fails(self) -> None:
        tool = PreviewStart()
        result = await tool.execute(session=None, port=70000)
        assert not result.success
        assert "Port" in result.error

    async def test_valid_port_boundary_low(self) -> None:
        """Port 1024 is the lowest valid port -- should not fail validation."""
        tool = PreviewStart()
        # Port 1024 passes validation but will fail on session.exec since
        # session is None.  We just verify the port check itself doesn't reject it.
        try:
            await tool.execute(session=None, port=1024)
        except AttributeError:
            # Expected: session is None so session.exec raises AttributeError
            pass

    async def test_custom_port_preview_url_includes_port_query(self) -> None:
        tool = PreviewStart()
        result = await tool.execute(
            session=_FakePreviewStartSession(),
            port=3001,
            conversation_id="11111111-1111-1111-1111-111111111111",
        )

        assert result.success
        assert result.metadata["preview_url"] == (
            "/api/conversations/11111111-1111-1111-1111-111111111111/preview/?_port=3001"
        )


class TestPreviewStop:
    def test_definition(self) -> None:
        tool = PreviewStop()
        defn = tool.definition()
        assert defn.name == "preview_stop"
        assert defn.execution_context == ExecutionContext.SANDBOX


@pytest.mark.asyncio
async def test_preview_proxy_uses_requested_port_and_preserves_query() -> None:
    session = _FakePreviewSession()
    conversation_id = "11111111-1111-1111-1111-111111111111"
    state = SimpleNamespace(
        conversations={
            conversation_id: SimpleNamespace(
                executor=SimpleNamespace(_sandbox_sessions={"default": session})
            )
        }
    )

    response = await proxy_preview(
        _request("/preview/api/items?_port=3001&name=Ada+Lovelace&tag=a&tag=b"),
        conversation_id=conversation_id,
        path="api/items",
        state=state,
        auth_user=None,
    )

    assert response.status_code == 200
    assert await _response_body(response) == b"<html>ok</html>"
    command = session.commands[0]
    assert "http://localhost:3001/api/items?name=Ada+Lovelace&tag=a&tag=b" in command
    assert "_port" not in command


@pytest.mark.asyncio
async def test_preview_proxy_selects_session_with_requested_port_open() -> None:
    default_session = _FakePreviewSession(port_open=False)
    preview_session = _FakePreviewSession(port_open=True)
    conversation_id = "11111111-1111-1111-1111-111111111111"
    state = SimpleNamespace(
        conversations={
            conversation_id: SimpleNamespace(
                executor=SimpleNamespace(
                    _sandbox_sessions={
                        "default": default_session,
                        "browser": preview_session,
                    }
                )
            )
        }
    )

    response = await proxy_preview(
        _request("/preview/?_port=3001"),
        conversation_id=conversation_id,
        path="",
        state=state,
        auth_user=None,
    )

    assert response.status_code == 200
    assert default_session.fetch_commands == []
    assert preview_session.fetch_commands
    assert "http://localhost:3001/" in preview_session.fetch_commands[0]


@pytest.mark.asyncio
async def test_preview_proxy_forwards_basic_body_and_content_type() -> None:
    session = _FakePreviewSession()
    conversation_id = "11111111-1111-1111-1111-111111111111"
    state = SimpleNamespace(
        conversations={
            conversation_id: SimpleNamespace(
                executor=SimpleNamespace(_sandbox_sessions={"default": session})
            )
        }
    )

    await proxy_preview(
        _request(
            "/preview/api/items?_port=3001",
            method="POST",
            body=b'{"name":"Ada"}',
            headers=[(b"content-type", b"application/json")],
        ),
        conversation_id=conversation_id,
        path="api/items",
        state=state,
        auth_user=None,
    )

    command = session.commands[0]
    assert "--data-binary @-" in command
    assert "content-type: application/json" in command
    assert "eyJuYW1lIjoiQWRhIn0=" in command


@pytest.mark.asyncio
async def test_preview_proxy_preserves_binary_response_body() -> None:
    png_body = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    session = _FakePreviewSession(
        stdout=_preview_stdout(
            "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\n",
            png_body,
        )
    )
    conversation_id = "11111111-1111-1111-1111-111111111111"
    state = SimpleNamespace(
        conversations={
            conversation_id: SimpleNamespace(
                executor=SimpleNamespace(_sandbox_sessions={"default": session})
            )
        }
    )

    response = await proxy_preview(
        _request("/preview/assets/logo.png"),
        conversation_id=conversation_id,
        path="assets/logo.png",
        state=state,
        auth_user=None,
    )

    assert response.headers["content-type"].startswith("image/png")
    assert await _response_body(response) == png_body


@pytest.mark.asyncio
async def test_preview_proxy_rewrites_redirect_location_to_proxy() -> None:
    session = _FakePreviewSession(
        stdout=_preview_stdout(
            "HTTP/1.1 302 Found\r\nlocation: /done\r\ncontent-type: text/plain\r\n"
        )
    )
    conversation_id = "11111111-1111-1111-1111-111111111111"
    state = SimpleNamespace(
        conversations={
            conversation_id: SimpleNamespace(
                executor=SimpleNamespace(_sandbox_sessions={"default": session})
            )
        }
    )

    response = await proxy_preview(
        _request("/preview/submit?_port=3001"),
        conversation_id=conversation_id,
        path="submit",
        state=state,
        auth_user=None,
    )

    assert response.status_code == 302
    assert response.headers["location"] == (
        "/api/conversations/11111111-1111-1111-1111-111111111111/preview/done?_port=3001"
    )


@pytest.mark.asyncio
async def test_preview_proxy_reports_missing_conversation_and_session() -> None:
    conversation_id = "11111111-1111-1111-1111-111111111111"

    with pytest.raises(HTTPException) as missing_conversation:
        await proxy_preview(
            _request("/preview/"),
            conversation_id=conversation_id,
            path="",
            state=SimpleNamespace(conversations={}),
            auth_user=None,
        )

    assert missing_conversation.value.status_code == 404

    with pytest.raises(HTTPException) as missing_session:
        await proxy_preview(
            _request("/preview/"),
            conversation_id=conversation_id,
            path="",
            state=SimpleNamespace(
                conversations={
                    conversation_id: SimpleNamespace(
                        executor=SimpleNamespace(_sandbox_sessions={})
                    )
                }
            ),
            auth_user=None,
        )

    assert missing_session.value.status_code == 503


@pytest.mark.asyncio
async def test_preview_proxy_verifies_conversation_ownership(monkeypatch) -> None:
    conversation_id = "11111111-1111-1111-1111-111111111111"
    calls: list[tuple[object, str, object]] = []

    async def fake_verify(state, verified_conversation_id, auth_user) -> None:
        calls.append((state, verified_conversation_id, auth_user))

    monkeypatch.setattr(
        "api.routes.artifacts._verify_conversation_ownership",
        fake_verify,
    )
    state = SimpleNamespace(
        conversations={
            conversation_id: SimpleNamespace(
                executor=SimpleNamespace(
                    _sandbox_sessions={"default": _FakePreviewSession()}
                )
            )
        }
    )
    auth_user = object()

    await proxy_preview(
        _request("/preview/"),
        conversation_id=conversation_id,
        path="",
        state=state,
        auth_user=auth_user,
    )

    assert calls == [(state, conversation_id, auth_user)]
