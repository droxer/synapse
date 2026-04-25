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


def _spawn_contract() -> dict[str, str]:
    return {
        "deliverable": "A concise worker summary.",
        "ownership_scope": "The declared plan step only.",
        "independence_reason": "This step can run independently from planner synthesis.",
    }


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
        **_spawn_contract(),
    )

    assert plan_result.success is True
    assert spawn_result.success is True
    assert len(manager.spawn_calls) == 1
    assert manager.spawn_calls[0].name == "Research topic agent"
    assert "Deliverable: A concise worker summary." in manager.spawn_calls[0].context


@pytest.mark.asyncio
async def test_agent_spawn_requires_worker_contract_fields() -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    result = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
    )

    assert result.success is False
    assert result.error == "deliverable must not be empty"
    assert manager.spawn_calls == []


@pytest.mark.asyncio
async def test_plan_create_replan_clears_spawned_and_waited_state() -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    first = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
        **_spawn_contract(),
    )
    planner_state.record_wait(["agent-123"])

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect updated source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    second = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the updated topic.",
        **_spawn_contract(),
    )

    assert first.success is True
    assert second.success is True
    assert len(manager.spawn_calls) == 2
    assert planner_state.spawned_agent_count == 1
    assert planner_state.waited_agent_count == 0


@pytest.mark.asyncio
async def test_agent_spawn_rejects_disallowed_execution_shape() -> None:
    planner_state = PlannerState()
    planner_state.configure_spawn_policy(
        execution_shape="single_agent",
        max_worker_spawns=0,
    )
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    result = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
        **_spawn_contract(),
    )

    assert result.success is False
    assert "not allowed" in (result.error or "")
    assert manager.spawn_calls == []


@pytest.mark.asyncio
async def test_agent_spawn_enforces_worker_limit() -> None:
    planner_state = PlannerState()
    planner_state.configure_spawn_policy(
        execution_shape="parallel",
        max_worker_spawns=1,
    )
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            },
            {
                "name": "Compare topic",
                "description": "Compare source material.",
                "execution_type": "parallel_worker",
            },
        ]
    )
    first = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
        **_spawn_contract(),
    )
    second = await spawn_tool.execute(
        name="Compare topic",
        task_description="Compare the topic.",
        **_spawn_contract(),
    )

    assert first.success is True
    assert second.success is False
    assert "worker limit reached" in (second.error or "")
    assert len(manager.spawn_calls) == 1


@pytest.mark.asyncio
async def test_agent_spawn_reuses_existing_agent_for_same_plan_step() -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)
    manager = _RecordingManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    first = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
        **_spawn_contract(),
    )
    second = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
        **_spawn_contract(),
    )

    assert first.success is True
    assert first.metadata is not None
    assert second.success is True
    assert second.output == "Agent already spawned with id: agent-123"
    assert second.metadata == {"agent_id": first.metadata["agent_id"]}
    assert len(manager.spawn_calls) == 1
    assert planner_state.spawned_agent_count == 1


@pytest.mark.asyncio
async def test_agent_spawn_redundant_rejection_is_not_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)

    class _RejectingManager:
        async def spawn(self, config: Any) -> str:
            del config
            raise RuntimeError(
                "Redundant task agent rejected; use allow_redundant=True for explicit voting/redundancy patterns"
            )

    class _RecordingLogger:
        def __init__(self) -> None:
            self.info_calls: list[tuple[Any, ...]] = []
            self.warning_calls: list[tuple[Any, ...]] = []

        def info(self, *args: Any) -> None:
            self.info_calls.append(args)

        def warning(self, *args: Any) -> None:
            self.warning_calls.append(args)

    logger = _RecordingLogger()
    monkeypatch.setattr("agent.tools.meta.spawn_task_agent.logger", logger)
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=_RejectingManager(),
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research topic",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    result = await spawn_tool.execute(
        name="Research topic",
        task_description="Research the topic.",
        **_spawn_contract(),
    )

    assert result.success is False
    assert result.error == (
        "Redundant task agent rejected; use allow_redundant=True for explicit voting/redundancy patterns"
    )
    assert logger.info_calls == [("spawn_task_agent_rejected reason=redundant_task",)]
    assert logger.warning_calls == []


@pytest.mark.asyncio
async def test_agent_spawn_reuses_manager_redundant_agent_id() -> None:
    planner_state = PlannerState()
    plan_tool = PlanCreate(EventEmitter(), planner_state=planner_state)

    class _RedundantManager:
        def __init__(self) -> None:
            self.spawn_calls: list[Any] = []

        async def spawn(self, config: Any) -> str:
            self.spawn_calls.append(config)
            raise RuntimeError(
                "Redundant task agent rejected; use allow_redundant=True for explicit voting/redundancy patterns"
            )

        def redundant_active_agent_id(self, config: Any) -> str:
            del config
            return "agent-existing"

    manager = _RedundantManager()
    spawn_tool = SpawnTaskAgent(
        sub_agent_manager=manager,
        planner_state=planner_state,
    )

    await plan_tool.execute(
        steps=[
            {
                "name": "Research prices",
                "description": "Collect source material.",
                "execution_type": "parallel_worker",
            }
        ]
    )
    result = await spawn_tool.execute(
        name="Research prices",
        task_description="Research product prices.",
        **_spawn_contract(),
    )

    assert result.success is True
    assert result.output == "Agent already spawned with id: agent-existing"
    assert result.metadata == {"agent_id": "agent-existing"}
    assert len(manager.spawn_calls) == 1
    assert planner_state.spawned_agent_count == 1


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
