"""Regression tests for skill filtering boundaries."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from agent.llm.client import LLMResponse, TokenUsage
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


class _RecordingClient:
    default_model = "claude-test"

    def __init__(self) -> None:
        self.last_tools: list[dict[str, Any]] | None = None

    async def create_message_stream(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        on_text_delta: Any | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        self.last_tools = tools
        return LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _FakeMCPTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="demo_server__lookup_docs",
            description="Lookup docs via MCP.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
            tags=("mcp", "demo_server"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        return ToolResult.ok("ok")


def _build_skill_registry() -> SkillRegistry:
    skill = SkillContent(
        metadata=SkillMetadata(
            name="deep-research",
            description="research a topic thoroughly",
            allowed_tools=("web_search", "web_fetch", "user_message"),
        ),
        instructions="Use deep research workflow.",
        directory_path=Path("/tmp/deep-research"),
        source_type="bundled",
    )
    return SkillRegistry((skill,))


def _tool_names(tools: list[dict[str, Any]] | None) -> set[str]:
    return {tool["name"] for tool in tools or []}


@pytest.mark.asyncio
async def test_orchestrator_excludes_unlisted_mcp_tools_when_skill_filters_registry() -> (
    None
):
    client = _RecordingClient()
    registry = ToolRegistry().register(_FakeMCPTool())
    orchestrator = AgentOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await orchestrator.run("please do deep research")

    assert "demo_server__lookup_docs" not in _tool_names(client.last_tools)


@pytest.mark.asyncio
async def test_planner_excludes_unlisted_mcp_tools_when_skill_filters_registry() -> (
    None
):
    client = _RecordingClient()
    registry = ToolRegistry().register(_FakeMCPTool())
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        sub_agent_manager=AsyncMock(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await planner.run("please do deep research")

    assert "demo_server__lookup_docs" not in _tool_names(client.last_tools)
