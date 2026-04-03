"""Tests for task runner failure modes and metrics."""

import asyncio
from types import SimpleNamespace

import pytest

from agent.llm.client import LLMResponse, TokenUsage, ToolCall
from agent.runtime.task_runner import TaskAgentConfig, TaskAgentRunner
from agent.tools.base import ToolResult
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType


def _task_settings(timeout_seconds: float = 5.0) -> SimpleNamespace:
    return SimpleNamespace(
        COMPACT_FULL_INTERACTIONS=5,
        COMPACT_FULL_DIALOGUE_TURNS=5,
        COMPACT_TOKEN_BUDGET=150_000,
        COMPACT_SUMMARY_MODEL="",
        LITE_MODEL="claude-lite-test",
        TASK_MODEL="claude-task-test",
        AGENT_TIMEOUT_SECONDS=timeout_seconds,
    )


class _SequenceClient:
    def __init__(self, *responses: LLMResponse) -> None:
        self._responses = list(responses)

    async def create_message_stream(self, **kwargs) -> LLMResponse:
        return self._responses.pop(0)


class _SlowClient:
    async def create_message_stream(self, **kwargs) -> LLMResponse:
        await asyncio.sleep(0.05)
        return LLMResponse(
            text="late reply",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _SequenceExecutor:
    def __init__(self, *results: ToolResult) -> None:
        self._results = list(results)

    async def execute(self, name: str, tool_input: dict[str, object]) -> ToolResult:
        return self._results.pop(0)


class _CompactingObserver:
    def __init__(self) -> None:
        self.compact_calls = 0

    def should_compact(
        self, messages: tuple[dict[str, object], ...], system_prompt: str = ""
    ) -> bool:
        return self.compact_calls == 0

    async def compact(
        self,
        messages: tuple[dict[str, object], ...],
        system_prompt: str = "",
    ) -> tuple[dict[str, object], ...]:
        self.compact_calls += 1
        return messages


class _NoopObserver:
    def should_compact(
        self, messages: tuple[dict[str, object], ...], system_prompt: str = ""
    ) -> bool:
        return False

    async def compact(
        self,
        messages: tuple[dict[str, object], ...],
        system_prompt: str = "",
    ) -> tuple[dict[str, object], ...]:
        return messages


@pytest.mark.asyncio
async def test_run_times_out_with_cancel_downstream_failure_mode_and_metrics(
    monkeypatch,
):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=0.01),
    )

    emitter = EventEmitter()
    events = []

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    runner = TaskAgentRunner(
        agent_id="agent-timeout",
        config=TaskAgentConfig(task_description="wait forever"),
        claude_client=_SlowClient(),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(),
        event_emitter=emitter,
        observer=_NoopObserver(),
    )

    result = await runner.run()

    assert result.success is False
    assert result.summary == ""
    assert result.error is not None
    assert "timed out" in result.error.lower()
    assert result.failure_mode == "cancel_downstream"
    assert result.metrics is not None
    assert result.metrics.iterations == 1
    assert result.metrics.tool_call_count == 0
    assert result.metrics.context_compaction_count == 0
    assert result.metrics.input_tokens == 0
    assert result.metrics.output_tokens == 0
    assert result.metrics.duration_seconds >= 0.0

    agent_complete = [
        event for event in events if event.type == EventType.AGENT_COMPLETE
    ]
    assert len(agent_complete) == 1
    assert agent_complete[0].data["success"] is False
    assert agent_complete[0].data["failure_mode"] == "cancel_downstream"
    assert agent_complete[0].data["timed_out"] is True
    assert agent_complete[0].data["timeout_seconds"] == 0.01
    assert "timed out" in agent_complete[0].data["error"].lower()
    assert agent_complete[0].data["metrics"] == {
        "duration_seconds": result.metrics.duration_seconds,
        "iterations": 1,
        "tool_call_count": 0,
        "context_compaction_count": 0,
        "input_tokens": 0,
        "output_tokens": 0,
    }


@pytest.mark.asyncio
async def test_run_emits_agent_complete_metrics_for_successful_execution(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    emitter = EventEmitter()
    events = []

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    runner = TaskAgentRunner(
        agent_id="agent-success",
        config=TaskAgentConfig(task_description="run a tool and finish"),
        claude_client=_SequenceClient(
            LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(id="tool-1", name="write_file", input={"path": "a.txt"}),
                ),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=11, output_tokens=5),
            ),
            LLMResponse(
                text="completed successfully",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=7, output_tokens=3),
            ),
        ),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(
            ToolResult.ok("saved file", metadata={"artifact_ids": ["artifact-1"]}),
        ),
        event_emitter=emitter,
        observer=_CompactingObserver(),
    )

    result = await runner.run()

    assert result.success is True
    assert result.summary == "completed successfully"
    assert result.failure_mode == "cancel_downstream"
    assert result.artifacts == ("artifact-1",)
    assert result.metrics is not None
    assert result.metrics.iterations == 2
    assert result.metrics.tool_call_count == 1
    assert result.metrics.context_compaction_count == 1
    assert result.metrics.input_tokens == 18
    assert result.metrics.output_tokens == 8
    assert result.metrics.duration_seconds >= 0.0

    agent_complete = [
        event for event in events if event.type == EventType.AGENT_COMPLETE
    ]
    assert len(agent_complete) == 1
    assert agent_complete[0].data["success"] is True
    assert agent_complete[0].data["failure_mode"] == "cancel_downstream"
    assert agent_complete[0].data["timed_out"] is False
    assert agent_complete[0].data["timeout_seconds"] == 5.0
    assert agent_complete[0].data["metrics"] == {
        "duration_seconds": result.metrics.duration_seconds,
        "iterations": 2,
        "tool_call_count": 1,
        "context_compaction_count": 1,
        "input_tokens": 18,
        "output_tokens": 8,
    }


@pytest.mark.asyncio
async def test_run_uses_config_timeout_seconds_override(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=1.0),
    )

    emitter = EventEmitter()
    events = []

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    runner = TaskAgentRunner(
        agent_id="agent-timeout-override",
        config=TaskAgentConfig(
            task_description="wait forever",
            timeout_seconds=0.01,
        ),
        claude_client=_SlowClient(),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(),
        event_emitter=emitter,
        observer=_NoopObserver(),
    )

    result = await runner.run()

    assert result.success is False
    assert result.error is not None
    assert "timed out" in result.error.lower()

    agent_complete = [
        event for event in events if event.type == EventType.AGENT_COMPLETE
    ]
    assert len(agent_complete) == 1
    assert agent_complete[0].data["timed_out"] is True
    assert agent_complete[0].data["timeout_seconds"] == 0.01
