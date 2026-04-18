"""Tests for planner/runtime guardrails that should stay lightweight."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from agent.tools.executor import ToolExecutor
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.meta.plan_create import PlanCreate
from agent.tools.meta.planner_state import PlannerState
from agent.tools.meta.spawn_task_agent import SpawnTaskAgent
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


class _RecordingManager:
    def __init__(self) -> None:
        self.spawn_calls: list[Any] = []

    async def spawn(self, config: Any) -> str:
        self.spawn_calls.append(config)
        return "agent-123"


class _FakeWebSearchTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="web_search",
            description="Search the web.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        return ToolResult.ok("ok")


class _FakeMCPTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="demo_server__lookup_docs",
            description="Lookup docs.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
            tags=("mcp", "demo_server"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        return ToolResult.ok("ok")


def _skill_registry() -> SkillRegistry:
    return SkillRegistry(
        (
            SkillContent(
                metadata=SkillMetadata(
                    name="deep-research",
                    description="research a topic thoroughly",
                    allowed_tools=("web_search",),
                ),
                instructions="Use deep research workflow.",
                directory_path=Path("/tmp/deep-research"),
                source_type="bundled",
            ),
        )
    )


@pytest.mark.asyncio
async def test_agent_spawn_requires_plan_create_first() -> None:
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=PlannerState(),
    )

    result = await spawn_tool.execute(
        name="Research",
        task_description="Research the topic.",
    )

    assert result.success is False
    assert result.error == "Call plan_create before agent_spawn."
    assert manager.spawn_calls == []


@pytest.mark.asyncio
async def test_agent_spawn_rejects_planner_owned_steps() -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    plan_result = await plan_tool.execute(
        steps=[
            {
                "name": "Synthesize findings",
                "description": "Combine worker outputs.",
                "execution_type": "planner_owned",
            }
        ]
    )
    spawn_result = await spawn_tool.execute(
        name="Synthesize findings",
        task_description="Synthesize everything.",
    )

    assert plan_result.success is True
    assert spawn_result.success is False
    assert "planner_owned" in (spawn_result.error or "")
    assert manager.spawn_calls == []


@pytest.mark.asyncio
async def test_agent_spawn_accepts_declared_worker_step() -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    plan_result = await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    spawn_result = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
    )

    assert plan_result.success is True
    assert spawn_result.success is True
    assert len(manager.spawn_calls) == 1


@pytest.mark.asyncio
async def test_tool_executor_blocks_tools_outside_allowlist() -> None:
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_skill_registry()))
    )
    executor = ToolExecutor(registry=registry)
    executor.set_allowed_tools({"activate_skill", "web_search"}, set())

    blocked = await executor.execute("demo_server__lookup_docs", {})
    allowed = await executor.execute("deep-research", {})

    assert blocked.success is False
    assert "not allowed" in (blocked.error or "")
    assert allowed.success is True
