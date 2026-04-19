from __future__ import annotations

import httpx
import pytest

from agent.tools.local import web_fetch
from agent.tools.local.web_fetch import WebFetch


class _MockAsyncClient:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self._responses = responses
        self._calls = 0

    async def __aenter__(self) -> _MockAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, url: str) -> httpx.Response:
        if self._calls >= len(self._responses):
            raise AssertionError(f"Unexpected fetch for {url}")
        response = self._responses[self._calls]
        self._calls += 1
        return response


@pytest.mark.asyncio
async def test_web_fetch_blocks_private_redirect_targets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start_url = "https://example.com/start"
    blocked_url = "http://169.254.169.254/latest/meta-data"

    redirect = httpx.Response(
        302,
        headers={"location": blocked_url},
        request=httpx.Request("GET", start_url),
    )

    monkeypatch.setattr(
        web_fetch.httpx,
        "AsyncClient",
        lambda **_: _MockAsyncClient([redirect]),
    )
    monkeypatch.setattr(
        web_fetch,
        "_validate_url",
        lambda candidate: "redirect blocked" if candidate == blocked_url else None,
    )

    tool = WebFetch()
    result = await tool.execute(url=start_url)

    assert not result.success
    assert result.error == "URL blocked: redirect blocked"


@pytest.mark.asyncio
async def test_web_fetch_returns_final_redirect_url_in_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start_url = "https://example.com/start"
    redirected_url = "https://example.com/final"

    redirect = httpx.Response(
        302,
        headers={"location": redirected_url},
        request=httpx.Request("GET", start_url),
    )
    final = httpx.Response(
        200,
        text="<html><body>Hello</body></html>",
        request=httpx.Request("GET", redirected_url),
    )

    monkeypatch.setattr(
        web_fetch.httpx,
        "AsyncClient",
        lambda **_: _MockAsyncClient([redirect, final]),
    )
    monkeypatch.setattr(web_fetch, "_validate_url", lambda candidate: None)

    tool = WebFetch()
    result = await tool.execute(url=start_url)

    assert result.success
    assert result.metadata["url"] == redirected_url
    assert result.metadata["requested_url"] == start_url
    assert result.metadata["redirected"] is True
