"""Tests for provider-backed web_search registration."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from agent.tools.registry import ToolRegistry
from api.builders import _register_web_search_provider
from config.settings import Settings


class _FakeSearchTool(LocalTool):
    def __init__(self, *, provider: str, name: str = "web_search") -> None:
        self.provider = provider
        self.name = name

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name=self.name,
            description=f"{self.provider} search",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
            tags=("search", "web"),
        )

    async def execute(self, **_: Any) -> ToolResult:
        return ToolResult.ok("{}")


class _FakeTavilyWebSearch(_FakeSearchTool):
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        super().__init__(provider="tavily")


class _FakeExaWebSearch(_FakeSearchTool):
    def __init__(self, api_key: str, *, tool_name: str = "exa_search") -> None:
        self.api_key = api_key
        super().__init__(provider="exa", name=tool_name)


@pytest.fixture
def fake_search_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("api.builders.TavilyWebSearch", _FakeTavilyWebSearch)
    monkeypatch.setattr("api.builders.ExaWebSearch", _FakeExaWebSearch)


def test_default_search_provider_registers_tavily_web_search(
    fake_search_tools: None,
) -> None:
    registry = _register_web_search_provider(
        ToolRegistry(),
        SimpleNamespace(TAVILY_API_KEY="tavily-key", EXA_API_KEY="exa-key"),
    )

    tool = registry.get("web_search")
    assert isinstance(tool, _FakeTavilyWebSearch)
    assert tool.provider == "tavily"
    assert tool.api_key == "tavily-key"
    assert registry.get("exa_search") is None


def test_exa_search_provider_registers_exa_as_web_search(
    fake_search_tools: None,
) -> None:
    registry = _register_web_search_provider(
        ToolRegistry(),
        SimpleNamespace(
            SEARCH_PROVIDER="exa",
            TAVILY_API_KEY="tavily-key",
            EXA_API_KEY="exa-key",
        ),
    )

    tool = registry.get("web_search")
    assert isinstance(tool, _FakeExaWebSearch)
    assert tool.provider == "exa"
    assert tool.api_key == "exa-key"
    assert registry.get("exa_search") is None


def test_tavily_search_provider_requires_tavily_key(fake_search_tools: None) -> None:
    with pytest.raises(RuntimeError, match="TAVILY_API_KEY"):
        _register_web_search_provider(
            ToolRegistry(),
            SimpleNamespace(
                SEARCH_PROVIDER="tavily", TAVILY_API_KEY="", EXA_API_KEY=""
            ),
        )


def test_exa_search_provider_requires_exa_key(fake_search_tools: None) -> None:
    with pytest.raises(RuntimeError, match="EXA_API_KEY"):
        _register_web_search_provider(
            ToolRegistry(),
            SimpleNamespace(SEARCH_PROVIDER="exa", TAVILY_API_KEY="", EXA_API_KEY=""),
        )


def test_unknown_search_provider_fails_clearly(fake_search_tools: None) -> None:
    with pytest.raises(ValueError, match="Unknown SEARCH_PROVIDER"):
        _register_web_search_provider(
            ToolRegistry(),
            SimpleNamespace(SEARCH_PROVIDER="brave", TAVILY_API_KEY="key"),
        )


def test_settings_allows_exa_without_tavily_key() -> None:
    settings = Settings(
        ANTHROPIC_API_KEY="anthropic-key",
        SEARCH_PROVIDER="exa",
        EXA_API_KEY="exa-key",
    )

    assert settings.SEARCH_PROVIDER == "exa"
    assert settings.TAVILY_API_KEY == ""


def test_settings_requires_selected_provider_key() -> None:
    with pytest.raises(
        ValueError, match="SEARCH_PROVIDER=tavily requires TAVILY_API_KEY"
    ):
        Settings(ANTHROPIC_API_KEY="anthropic-key")
