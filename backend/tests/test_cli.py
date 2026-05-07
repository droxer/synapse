from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from cli import main as cli_main


class _FakeAsyncClient:
    response = httpx.Response(202, json={})
    error: httpx.RequestError | None = None
    requests: list[dict[str, Any]] = []

    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    async def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any] | None = None,
    ) -> httpx.Response:
        self.requests.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "json": json,
                "timeout": self.timeout,
            }
        )
        if self.error is not None:
            raise self.error
        return self.response


@pytest.fixture(autouse=True)
def _reset_fake_client(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeAsyncClient.response = httpx.Response(
        202,
        json={
            "run_id": "00000000-0000-0000-0000-000000000001",
            "conversation_id": "00000000-0000-0000-0000-000000000002",
            "status": "queued",
        },
    )
    _FakeAsyncClient.error = None
    _FakeAsyncClient.requests = []
    monkeypatch.setattr(cli_main.httpx, "AsyncClient", _FakeAsyncClient)


def _args(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "api_key": "secret",
        "base_url": "http://example.test",
        "command": "run",
        "conversation_id": "00000000-0000-0000-0000-000000000010",
        "format": "json",
        "idempotency_key": None,
        "message": "hello",
        "planner": False,
        "run_id": "00000000-0000-0000-0000-000000000020",
        "skills": None,
        "timeout": 120.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_run_sends_idempotency_key() -> None:
    result = await cli_main._run(
        _args(command="run", idempotency_key="key-1", message="start")
    )

    assert result == 0
    request = _FakeAsyncClient.requests[0]
    assert request["method"] == "POST"
    assert request["url"] == "http://example.test/v1/agent-runs"
    assert request["headers"]["Idempotency-Key"] == "key-1"
    assert request["json"]["message"] == "start"


@pytest.mark.asyncio
async def test_message_sends_idempotency_key() -> None:
    result = await cli_main._run(
        _args(command="message", idempotency_key="key-1", message="follow up")
    )

    assert result == 0
    request = _FakeAsyncClient.requests[0]
    assert request["method"] == "POST"
    assert (
        request["url"]
        == "http://example.test/v1/conversations/00000000-0000-0000-0000-000000000010/messages"
    )
    assert request["headers"]["Idempotency-Key"] == "key-1"
    assert request["json"]["message"] == "follow up"


@pytest.mark.asyncio
async def test_transport_error_returns_compact_error(
    capsys: pytest.CaptureFixture[str],
) -> None:
    _FakeAsyncClient.error = httpx.ConnectError("connection refused")

    with pytest.raises(SystemExit) as exc_info:
        await cli_main._run(_args(command="status"))

    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert "request_failed" in captured.err
    assert "connection refused" in captured.err
    assert (
        "http://example.test/v1/agent-runs/00000000-0000-0000-0000-000000000020"
        in captured.err
    )
    assert "Traceback" not in captured.err


@pytest.mark.asyncio
async def test_missing_api_key_returns_exit_code_2(
    capsys: pytest.CaptureFixture[str],
) -> None:
    result = await cli_main._run(_args(api_key=None))

    assert result == 2
    captured = capsys.readouterr()
    assert "Missing API key" in captured.err
    assert _FakeAsyncClient.requests == []
