"""Tests for observer configuration in runtime orchestrators."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.runtime.task_runner import TaskAgentConfig, TaskAgentRunner
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


def _settings(summary_model: str = "") -> SimpleNamespace:
    return SimpleNamespace(
        COMPACT_FULL_INTERACTIONS=7,
        COMPACT_TOKEN_BUDGET=4321,
        COMPACT_SUMMARY_MODEL=summary_model,
        LITE_MODEL="claude-lite-test",
    )


def test_orchestrator_uses_compaction_settings(monkeypatch) -> None:
    monkeypatch.setattr("agent.runtime.orchestrator.get_settings", lambda: _settings())

    orchestrator = AgentOrchestrator(
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=EventEmitter(),
        system_prompt="test",
    )

    assert orchestrator._observer._max_full_interactions == 7
    assert orchestrator._observer._token_budget == 4321
    assert orchestrator._observer._summary_model == "claude-lite-test"


def test_task_runner_uses_explicit_summary_model(monkeypatch) -> None:
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _settings("claude-summary-test"),
    )

    runner = TaskAgentRunner(
        agent_id="agent-1",
        config=TaskAgentConfig(task_description="do the thing"),
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=EventEmitter(),
    )

    assert runner._observer._summary_model == "claude-summary-test"


def test_planner_uses_compaction_settings(monkeypatch) -> None:
    monkeypatch.setattr("agent.runtime.planner.get_settings", lambda: _settings())

    base_executor = ToolExecutor(registry=ToolRegistry())
    planner = PlannerOrchestrator(
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=base_executor,
        event_emitter=EventEmitter(),
        sub_agent_manager=MagicMock(),
    )

    assert planner._observer._max_full_interactions == 7
    assert planner._observer._token_budget == 4321
    assert planner._observer._summary_model == "claude-lite-test"
