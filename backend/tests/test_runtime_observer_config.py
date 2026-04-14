"""Tests for observer configuration in runtime orchestrators."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from agent.context.profiles import resolve_compaction_profile
from config.settings import Settings
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.runtime.task_runner import TaskAgentConfig, TaskAgentRunner
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


def _settings(summary_model: str = "", **overrides) -> SimpleNamespace:
    values = dict(
        COMPACT_FULL_INTERACTIONS=7,
        COMPACT_FULL_DIALOGUE_TURNS=5,
        COMPACT_TOKEN_BUDGET=4321,
        COMPACT_TOKEN_COUNTER="weighted",
        COMPACT_FALLBACK_PREVIEW_CHARS=500,
        COMPACT_FALLBACK_RESULT_CHARS=1000,
        COMPACT_SUMMARY_MODEL=summary_model,
        COMPACT_DIALOGUE_FALLBACK_CHARS=12_000,
        COMPACT_CONTEXT_SUMMARY_MAX_CHARS=32_000,
        COMPACT_RECONSTRUCT_TAIL_MESSAGES=80,
        COMPACT_MEMORY_FLUSH=False,
        COMPACT_WEB_TOKEN_BUDGET=None,
        COMPACT_WEB_TOKEN_COUNTER=None,
        COMPACT_WEB_FULL_INTERACTIONS=None,
        COMPACT_WEB_FALLBACK_PREVIEW_CHARS=None,
        COMPACT_WEB_FALLBACK_RESULT_CHARS=None,
        COMPACT_WEB_SUMMARY_MODEL=None,
        COMPACT_WEB_FULL_DIALOGUE_TURNS=None,
        COMPACT_WEB_DIALOGUE_FALLBACK_CHARS=None,
        COMPACT_WEB_CONTEXT_SUMMARY_MAX_CHARS=None,
        COMPACT_WEB_RECONSTRUCT_TAIL_MESSAGES=None,
        COMPACT_WEB_MEMORY_FLUSH=None,
        COMPACT_CHANNEL_TOKEN_BUDGET=None,
        COMPACT_CHANNEL_TOKEN_COUNTER=None,
        COMPACT_CHANNEL_FULL_INTERACTIONS=None,
        COMPACT_CHANNEL_FALLBACK_PREVIEW_CHARS=None,
        COMPACT_CHANNEL_FALLBACK_RESULT_CHARS=None,
        COMPACT_CHANNEL_SUMMARY_MODEL=None,
        COMPACT_CHANNEL_FULL_DIALOGUE_TURNS=None,
        COMPACT_CHANNEL_DIALOGUE_FALLBACK_CHARS=None,
        COMPACT_CHANNEL_CONTEXT_SUMMARY_MAX_CHARS=None,
        COMPACT_CHANNEL_RECONSTRUCT_TAIL_MESSAGES=None,
        COMPACT_CHANNEL_MEMORY_FLUSH=None,
        COMPACT_PLANNER_TOKEN_BUDGET=None,
        COMPACT_PLANNER_TOKEN_COUNTER=None,
        COMPACT_PLANNER_FULL_INTERACTIONS=None,
        COMPACT_PLANNER_FALLBACK_PREVIEW_CHARS=None,
        COMPACT_PLANNER_FALLBACK_RESULT_CHARS=None,
        COMPACT_PLANNER_SUMMARY_MODEL=None,
        COMPACT_PLANNER_FULL_DIALOGUE_TURNS=None,
        COMPACT_PLANNER_DIALOGUE_FALLBACK_CHARS=None,
        COMPACT_PLANNER_CONTEXT_SUMMARY_MAX_CHARS=None,
        COMPACT_PLANNER_RECONSTRUCT_TAIL_MESSAGES=None,
        COMPACT_PLANNER_MEMORY_FLUSH=None,
        COMPACT_TASK_AGENT_TOKEN_BUDGET=None,
        COMPACT_TASK_AGENT_TOKEN_COUNTER=None,
        COMPACT_TASK_AGENT_FULL_INTERACTIONS=None,
        COMPACT_TASK_AGENT_FALLBACK_PREVIEW_CHARS=None,
        COMPACT_TASK_AGENT_FALLBACK_RESULT_CHARS=None,
        COMPACT_TASK_AGENT_SUMMARY_MODEL=None,
        COMPACT_TASK_AGENT_FULL_DIALOGUE_TURNS=None,
        COMPACT_TASK_AGENT_DIALOGUE_FALLBACK_CHARS=None,
        COMPACT_TASK_AGENT_CONTEXT_SUMMARY_MAX_CHARS=None,
        COMPACT_TASK_AGENT_RECONSTRUCT_TAIL_MESSAGES=None,
        COMPACT_TASK_AGENT_MEMORY_FLUSH=None,
        LITE_MODEL="claude-lite-test",
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_settings_define_token_counter() -> None:
    settings = Settings(ANTHROPIC_API_KEY="test-key", TAVILY_API_KEY="test-key")

    assert settings.COMPACT_TOKEN_COUNTER == "weighted"


def test_settings_reject_invalid_token_counter() -> None:
    with pytest.raises(ValidationError, match="COMPACT_TOKEN_COUNTER"):
        Settings(
            ANTHROPIC_API_KEY="test-key",
            TAVILY_API_KEY="test-key",
            COMPACT_TOKEN_COUNTER="invalid",
        )


def test_profile_resolution_inherits_global_defaults() -> None:
    profile = resolve_compaction_profile(
        _settings(summary_model=""), "channel_conversation"
    )

    assert profile.name == "channel_conversation"
    assert profile.token_budget == 4321
    assert profile.token_counter == "weighted"
    assert profile.max_full_interactions == 7
    assert profile.reconstruct_tail_messages == 80
    assert profile.context_summary_max_chars == 32_000


def test_profile_resolution_applies_runtime_overrides() -> None:
    profile = resolve_compaction_profile(
        _settings(
            COMPACT_CHANNEL_TOKEN_BUDGET=999,
            COMPACT_CHANNEL_FULL_INTERACTIONS=2,
            COMPACT_CHANNEL_SUMMARY_MODEL="claude-channel-summary",
            COMPACT_CHANNEL_RECONSTRUCT_TAIL_MESSAGES=12,
            COMPACT_CHANNEL_MEMORY_FLUSH=True,
        ),
        "channel_conversation",
    )

    assert profile.token_budget == 999
    assert profile.max_full_interactions == 2
    assert profile.summary_model == "claude-channel-summary"
    assert profile.reconstruct_tail_messages == 12
    assert profile.memory_flush is True


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
    assert orchestrator._observer._max_full_dialogue_turns == 5
    assert orchestrator._observer._token_budget == 4321
    assert orchestrator._observer._summary_model == "claude-lite-test"
    assert orchestrator._compaction_profile.name == "web_conversation"


def test_task_runner_uses_explicit_summary_model(monkeypatch) -> None:
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _settings(
            "claude-summary-test",
            COMPACT_TASK_AGENT_SUMMARY_MODEL="claude-task-summary",
        ),
    )

    runner = TaskAgentRunner(
        agent_id="agent-1",
        config=TaskAgentConfig(task_description="do the thing"),
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=EventEmitter(),
    )

    assert runner._observer._summary_model == "claude-task-summary"
    assert runner._compaction_profile.name == "task_agent"


def test_planner_uses_compaction_settings(monkeypatch) -> None:
    monkeypatch.setattr(
        "agent.runtime.planner.get_settings",
        lambda: _settings(COMPACT_PLANNER_TOKEN_BUDGET=2468),
    )

    base_executor = ToolExecutor(registry=ToolRegistry())
    planner = PlannerOrchestrator(
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=base_executor,
        event_emitter=EventEmitter(),
        sub_agent_manager=MagicMock(),
    )

    assert planner._observer._max_full_interactions == 7
    assert planner._observer._token_budget == 2468
    assert planner._observer._summary_model == "claude-lite-test"
    assert planner._compaction_profile.name == "planner"
