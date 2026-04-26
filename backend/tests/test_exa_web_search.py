"""Tests for the Exa web search tool."""

from __future__ import annotations

import json
import sys
import types
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _stub_exa_py(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provide a minimal `exa_py` module so the tool can be imported without the dep."""
    module = types.ModuleType("exa_py")

    class _StubExa:
        def __init__(self, api_key: str, **_: Any) -> None:
            self.api_key = api_key
            self.headers: dict[str, str] = {}

        def search_and_contents(
            self, *args: Any, **kwargs: Any
        ) -> Any:  # pragma: no cover
            raise NotImplementedError

    module.Exa = _StubExa  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "exa_py", module)


class _Result:
    def __init__(
        self,
        *,
        title: str = "",
        url: str = "",
        text: str | None = None,
        highlights: list[str] | None = None,
        summary: str | None = None,
        score: float | None = None,
        published_date: str | None = None,
        author: str | None = None,
    ) -> None:
        self.title = title
        self.url = url
        self.text = text
        self.highlights = highlights
        self.summary = summary
        self.score = score
        self.published_date = published_date
        self.author = author


class _Response:
    def __init__(self, results: list[_Result]) -> None:
        self.results = results


class _FakeExa:
    """Captures search_and_contents calls and returns a scripted response."""

    def __init__(self, response: _Response) -> None:
        self._response = response
        self.headers: dict[str, str] = {}
        self.calls: list[dict[str, Any]] = []

    def search_and_contents(self, **kwargs: Any) -> _Response:
        self.calls.append(dict(kwargs))
        return self._response


def _install_fake_client(
    monkeypatch: pytest.MonkeyPatch, response: _Response
) -> _FakeExa:
    fake = _FakeExa(response)
    import exa_py

    monkeypatch.setattr(exa_py, "Exa", lambda api_key=None, **_: fake)
    return fake


@pytest.mark.asyncio
async def test_exa_search_returns_highlights_snippets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _install_fake_client(
        monkeypatch,
        _Response(
            [
                _Result(
                    title="LLM scaling",
                    url="https://example.com/llm",
                    highlights=["Scaling laws hold", "Compute drives gains"],
                    score=0.91,
                    published_date="2026-01-15",
                    author="Jane Doe",
                )
            ]
        ),
    )

    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")
    result = await tool.execute(query="llm scaling", max_results=3)

    assert result.success
    payload = json.loads(result.output)
    assert payload["query"] == "llm scaling"
    assert len(payload["results"]) == 1
    first = payload["results"][0]
    assert first["title"] == "LLM scaling"
    assert first["url"] == "https://example.com/llm"
    assert first["content"] == "Scaling laws hold ... Compute drives gains"
    assert first["highlights"] == ["Scaling laws hold", "Compute drives gains"]
    assert first["score"] == 0.91
    assert first["author"] == "Jane Doe"
    assert result.metadata["result_count"] == 1

    assert fake.headers["x-exa-integration"] == "synapse"
    assert fake.calls[0]["num_results"] == 3
    assert fake.calls[0]["type"] == "auto"
    assert "highlights" in fake.calls[0]


@pytest.mark.asyncio
async def test_exa_search_falls_back_to_summary_then_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_client(
        monkeypatch,
        _Response(
            [
                _Result(
                    title="Has summary", url="https://a.test", summary="Key summary"
                ),
                _Result(title="Has text", url="https://b.test", text="Body text"),
                _Result(title="Has nothing", url="https://c.test"),
            ]
        ),
    )

    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")
    result = await tool.execute(query="fallback test")

    assert result.success
    results = json.loads(result.output)["results"]
    assert results[0]["content"] == "Key summary"
    assert results[0]["summary"] == "Key summary"
    assert results[1]["content"] == "Body text"
    assert "summary" not in results[1]
    assert results[2]["content"] == ""


@pytest.mark.asyncio
async def test_exa_search_forwards_filters_and_content_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _install_fake_client(monkeypatch, _Response([]))

    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")
    result = await tool.execute(
        query="climate policy",
        max_results=8,
        search_type="neural",
        content_mode="text",
        category="research paper",
        include_domains=["arxiv.org"],
        exclude_domains=["reddit.com"],
        include_text=["climate policy"],
        exclude_text=["opinion"],
        start_published_date="2024-01-01",
        end_published_date="2026-01-01",
        user_location="US",
    )

    assert result.success
    call = fake.calls[0]
    assert call["query"] == "climate policy"
    assert call["num_results"] == 8
    assert call["type"] == "neural"
    assert call["category"] == "research paper"
    assert call["include_domains"] == ["arxiv.org"]
    assert call["exclude_domains"] == ["reddit.com"]
    assert call["include_text"] == ["climate policy"]
    assert call["exclude_text"] == ["opinion"]
    assert call["start_published_date"] == "2024-01-01"
    assert call["end_published_date"] == "2026-01-01"
    assert call["user_location"] == "US"
    assert "text" in call and "highlights" not in call


@pytest.mark.asyncio
async def test_exa_search_empty_query_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_client(monkeypatch, _Response([]))

    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")
    result = await tool.execute(query="   ")
    assert not result.success
    assert "empty" in (result.error or "").lower()


@pytest.mark.asyncio
async def test_exa_search_rejects_invalid_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_client(monkeypatch, _Response([]))

    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")
    result = await tool.execute(query="test", category="not-a-category")
    assert not result.success
    assert "category" in (result.error or "").lower()


@pytest.mark.asyncio
async def test_exa_search_wraps_sdk_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class _BoomClient:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def search_and_contents(self, **_: Any) -> Any:
            raise RuntimeError("upstream timeout")

    import exa_py

    monkeypatch.setattr(exa_py, "Exa", lambda api_key=None, **_: _BoomClient())

    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")
    result = await tool.execute(query="anything")
    assert not result.success
    assert "upstream timeout" in (result.error or "")


def test_exa_search_requires_api_key() -> None:
    from agent.tools.local.exa_web_search import ExaWebSearch

    with pytest.raises(ValueError):
        ExaWebSearch(api_key="")


def test_exa_search_default_tool_name() -> None:
    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key")

    assert tool.definition().name == "exa_search"


def test_exa_search_can_be_exposed_as_web_search() -> None:
    from agent.tools.local.exa_web_search import ExaWebSearch

    tool = ExaWebSearch(api_key="test-key", tool_name="web_search")

    assert tool.definition().name == "web_search"
