"""Tests for planner lifecycle behavior."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agent.context.profiles import CompactionProfile
from agent.llm.client import LLMResponse, TokenUsage
from agent.runtime.orchestrator import AgentState
from agent.runtime.planner import (
    PlannerOrchestrator,
    _build_turn_locale_runtime_sections,
)
from agent.runtime.hooks import ContextCompactionContext, ContextCompactionResult
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


class _RecordingObserver:
    def __init__(self, profile: CompactionProfile | None = None) -> None:
        if profile is not None:
            self.profile = profile
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


class _RecordingCompactionHooks:
    def __init__(self, events: list[str], expected_messages: tuple[dict, ...]) -> None:
        self._events = events
        self._expected_messages = expected_messages
        self.after_result: ContextCompactionResult | None = None

    async def before_session_start(self, context):
        raise AssertionError("not used")

    async def before_turn(self, context):
        return context.runtime_prompt_sections

    async def after_turn(self, context, status, result):
        del context, status, result

    async def before_context_compaction(
        self,
        context: ContextCompactionContext,
    ) -> None:
        assert context.messages == self._expected_messages
        assert context.metadata["memory_flush"] is True
        self._events.append("hook_before")

    async def after_context_compaction(
        self,
        context: ContextCompactionContext,
        result: ContextCompactionResult,
    ) -> None:
        del context
        self.after_result = result
        self._events.append("hook_after")


def _planner_profile(*, memory_flush: bool = False) -> CompactionProfile:
    return CompactionProfile(
        name="planner",
        token_budget=1000,
        token_counter="weighted",
        max_full_interactions=5,
        fallback_preview_chars=500,
        fallback_result_chars=1000,
        summary_model="",
        max_full_dialogue_turns=5,
        dialogue_fallback_chars=12_000,
        context_summary_max_chars=32_000,
        reconstruct_tail_messages=80,
        memory_flush=memory_flush,
    )


class TestPlannerCompaction:
    @pytest.mark.asyncio
    async def test_run_iteration_uses_effective_prompt_for_compaction(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            "agent.runtime.planner.get_settings",
            lambda: SimpleNamespace(LITE_MODEL="test-model"),
        )
        observer = _RecordingObserver()
        profile = _planner_profile()
        planner = PlannerOrchestrator(
            claude_client=_FakePlannerClient(),  # type: ignore[arg-type]
            tool_registry=ToolRegistry(),
            tool_executor=ToolExecutor(registry=ToolRegistry()),
            event_emitter=EventEmitter(),
            sub_agent_manager=MagicMock(),
            observer=observer,  # type: ignore[arg-type]
            compaction_profile=profile,
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

    @pytest.mark.asyncio
    async def test_run_iteration_calls_compaction_hooks_around_compaction(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            "agent.runtime.planner.get_settings",
            lambda: SimpleNamespace(LITE_MODEL="test-model"),
        )
        events: list[str] = []
        profile = _planner_profile(memory_flush=True)
        observer = _RecordingObserver(profile=profile)

        original_compact = observer.compact

        async def compact_after_flush(messages, system_prompt=""):
            events.append("compact")
            return await original_compact(messages, system_prompt)

        observer.compact = compact_after_flush  # type: ignore[method-assign]
        state = AgentState(
            messages=({"role": "user", "content": "my timezone is UTC+8"},)
        )
        hooks = _RecordingCompactionHooks(events, state.messages)
        planner = PlannerOrchestrator(
            claude_client=_FakePlannerClient(),  # type: ignore[arg-type]
            tool_registry=ToolRegistry(),
            tool_executor=ToolExecutor(registry=ToolRegistry()),
            event_emitter=EventEmitter(),
            sub_agent_manager=MagicMock(),
            observer=observer,  # type: ignore[arg-type]
            compaction_profile=profile,
            system_prompt="base prompt",
            conversation_hooks=hooks,
        )

        result = await planner._run_iteration(
            state,
            tools=[],
            model="test-model",
        )

        assert result.completed is True
        assert events == ["hook_before", "compact", "hook_after"]
        assert hooks.after_result is not None
        assert hooks.after_result.original_message_count == 1


def test_build_turn_locale_runtime_sections_requires_localized_plan_output() -> None:
    sections = _build_turn_locale_runtime_sections({"locale": "zh-CN"})

    assert len(sections) == 1
    assert "preferred_language: Simplified Chinese" in sections[0]
    assert (
        "plan_create step names and descriptions must be written in this language"
        in sections[0]
    )
