"""Tests for runtime-specific compaction profile wiring."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.context.profiles import CompactionProfile
from agent.tools.registry import ToolRegistry
from api.builders import _build_orchestrator, _build_planner_orchestrator
from api.events import EventEmitter
from api.routes.conversations import _load_initial_messages_for_conversation


def _settings(**overrides) -> SimpleNamespace:
    values = dict(
        TAVILY_API_KEY="test-key",
        MAX_ITERATIONS=50,
        THINKING_BUDGET=100,
        SKILLS_ENABLED=False,
        MAX_CONCURRENT_AGENTS=4,
        MAX_TOTAL_AGENTS=12,
        MAX_AGENT_ITERATIONS=25,
        LITE_MODEL="claude-lite-test",
        DEFAULT_SYSTEM_PROMPT="default prompt",
        COMPACT_TOKEN_BUDGET=4000,
        COMPACT_TOKEN_COUNTER="weighted",
        COMPACT_FULL_INTERACTIONS=7,
        COMPACT_FALLBACK_PREVIEW_CHARS=500,
        COMPACT_FALLBACK_RESULT_CHARS=1000,
        COMPACT_SUMMARY_MODEL="",
        COMPACT_FULL_DIALOGUE_TURNS=5,
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
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_builder_uses_channel_profile(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        "api.builders.get_settings",
        lambda: _settings(COMPACT_CHANNEL_TOKEN_BUDGET=1234),
    )
    monkeypatch.setattr(
        "api.builders._build_base_registry", lambda *args, **kwargs: ToolRegistry()
    )
    monkeypatch.setattr(
        "api.builders.ArtifactManager", lambda storage_backend=None: MagicMock()
    )

    class FakeAgentOrchestrator:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.on_task_complete = lambda summary: None

    monkeypatch.setattr("api.builders.AgentOrchestrator", FakeAgentOrchestrator)

    _build_orchestrator(
        claude_client=MagicMock(),
        event_emitter=EventEmitter(),
        sandbox_provider=MagicMock(),
        compaction_runtime="channel_conversation",
    )

    profile = captured["compaction_profile"]
    assert isinstance(profile, CompactionProfile)
    assert profile.name == "channel_conversation"
    assert profile.token_budget == 1234


def test_planner_builder_uses_planner_profile(monkeypatch) -> None:
    captured_planner_kwargs: dict[str, object] = {}

    monkeypatch.setattr(
        "api.builders.get_settings",
        lambda: _settings(COMPACT_PLANNER_TOKEN_BUDGET=2468),
    )
    monkeypatch.setattr(
        "api.builders._build_sub_agent_registry_factory",
        lambda *args: "registry-factory",
    )
    monkeypatch.setattr(
        "api.builders._build_base_registry", lambda *args, **kwargs: ToolRegistry()
    )
    monkeypatch.setattr(
        "api.builders._build_planner_registry", lambda *args, **kwargs: ToolRegistry()
    )
    monkeypatch.setattr(
        "api.builders.ArtifactManager", lambda storage_backend=None: MagicMock()
    )

    class FakeSubAgentManager:
        def __init__(self, **kwargs):
            pass

    class FakePlannerOrchestrator:
        def __init__(self, **kwargs):
            captured_planner_kwargs.update(kwargs)
            self.on_task_complete = lambda summary: None
            self._executor = kwargs["tool_executor"]

    monkeypatch.setattr("api.builders.SubAgentManager", FakeSubAgentManager)
    monkeypatch.setattr("api.builders.PlannerOrchestrator", FakePlannerOrchestrator)

    _build_planner_orchestrator(
        claude_client=MagicMock(),
        event_emitter=EventEmitter(),
        sandbox_provider=MagicMock(),
    )

    profile = captured_planner_kwargs["compaction_profile"]
    assert isinstance(profile, CompactionProfile)
    assert profile.name == "planner"
    assert profile.token_budget == 2468


@pytest.mark.asyncio
async def test_reconstruction_uses_profile_reconstruct_tail(monkeypatch) -> None:
    recent_messages = [SimpleNamespace(role="user", content={"text": "hello"})]
    get_recent_messages = AsyncMock(return_value=recent_messages)
    state = SimpleNamespace(
        db_session_factory=_dummy_session_factory(),
        db_repo=SimpleNamespace(
            get_recent_messages=get_recent_messages,
            get_messages=AsyncMock(return_value=[]),
        ),
        claude_client=MagicMock(),
    )
    convo = SimpleNamespace(id="conv-1", context_summary="summary")
    captured: dict[str, object] = {}
    profile = CompactionProfile(
        name="channel_conversation",
        token_budget=1000,
        token_counter="weighted",
        max_full_interactions=5,
        fallback_preview_chars=500,
        fallback_result_chars=1000,
        summary_model="",
        max_full_dialogue_turns=5,
        dialogue_fallback_chars=12_000,
        context_summary_max_chars=32_000,
        reconstruct_tail_messages=12,
        memory_flush=False,
    )

    class FakeObserver:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def should_compact(self, messages, system_prompt=""):
            return False

        async def compact(self, messages, system_prompt=""):
            return messages

    monkeypatch.setattr("api.routes.conversations.Observer", FakeObserver)
    monkeypatch.setattr(
        "api.routes.conversations.build_agent_system_prompt",
        lambda memory_entries, user_skill_registry: "",
    )
    monkeypatch.setattr(
        "api.routes.conversations.get_settings",
        lambda: _settings(),
    )

    messages = await _load_initial_messages_for_conversation(
        state,
        convo,
        memory_entries=[],
        user_skill_registry=None,
        compaction_profile=profile,
    )

    get_recent_messages.assert_awaited_once()
    assert get_recent_messages.await_args.args[2] == 12
    assert captured["profile"] == profile
    assert messages[0]["role"] == "assistant"


def _dummy_session_factory():
    session = MagicMock()

    class _Manager:
        async def __aenter__(self):
            return session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    return lambda: _Manager()
