"""Tests for planner lifecycle behavior."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agent.llm.client import LLMResponse, TokenUsage
from agent.runtime.orchestrator import AgentState
from agent.runtime.planner import (
    PlannerOrchestrator,
    _build_turn_locale_runtime_sections,
)
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


class _RecordingObserver:
    def __init__(self) -> None:
        self.should_compact_calls: list[tuple[tuple[dict, ...], str]] = []
        self.compact_calls: list[tuple[tuple[dict, ...], str]] = []

    def should_compact(self, messages, system_prompt="") -> bool:
        self.should_compact_calls.append((messages, system_prompt))
        return True

    async def compact(self, messages, system_prompt=""):
        self.compact_calls.append((messages, system_prompt))
        return messages


class _FakePlannerClient:
    async def create_message_stream(self, **kwargs):
        return LLMResponse(
            text="planned",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class TestPlannerCompaction:
    @pytest.mark.asyncio
    async def test_run_iteration_uses_effective_prompt_for_compaction(self):
        observer = _RecordingObserver()
        planner = PlannerOrchestrator(
            claude_client=_FakePlannerClient(),  # type: ignore[arg-type]
            tool_registry=ToolRegistry(),
            tool_executor=ToolExecutor(registry=ToolRegistry()),
            event_emitter=EventEmitter(),
            sub_agent_manager=MagicMock(),
            observer=observer,  # type: ignore[arg-type]
            system_prompt="base prompt",
        )
        state = AgentState(messages=({"role": "user", "content": "plan this"},))

        result = await planner._run_iteration(
            state,
            tools=[],
            model="test-model",
            system_prompt="expanded prompt",
        )

        assert result.completed is True
        assert observer.should_compact_calls == [(state.messages, "expanded prompt")]
        assert observer.compact_calls == [(state.messages, "expanded prompt")]


def test_build_turn_locale_runtime_sections_requires_localized_plan_output() -> None:
    sections = _build_turn_locale_runtime_sections({"locale": "zh-CN"})

    assert len(sections) == 1
    assert "preferred_language: Simplified Chinese" in sections[0]
    assert (
        "plan_create step names and descriptions must be written in this language"
        in sections[0]
    )
