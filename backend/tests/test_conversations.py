"""Tests for conversation metrics aggregation helper."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from agent.state.schemas import EventRecord

# The conversations module transitively imports api.auth which triggers
# ``get_settings()`` at module scope.  Provide dummy env vars so the import
# succeeds without real secrets.
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TAVILY_API_KEY", "test-key")

from agent.llm.client import AnthropicClient, LLMResponse, TokenUsage  # noqa: E402
from api.models import ConversationMetricsResponse  # noqa: E402
from api.routes.conversations import (  # noqa: E402
    _EXECUTION_ROUTER_SYSTEM_PROMPT,
    EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
    EXECUTION_SHAPE_PARALLEL,
    EXECUTION_SHAPE_PROMPT_CHAIN,
    EXECUTION_SHAPE_SINGLE_AGENT,
    _build_conversation_metrics_response,
    _classify_execution_shape,
    _planner_flag_to_mode,
    _resolve_execution_route,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(
    event_type: str,
    data: dict,
    *,
    conversation_id: uuid.UUID | None = None,
    iteration: int | None = None,
    event_id: int = 1,
) -> EventRecord:
    return EventRecord(
        id=event_id,
        conversation_id=conversation_id or uuid.uuid4(),
        event_type=event_type,
        data=data,
        iteration=iteration,
        timestamp=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Token aggregation
# ---------------------------------------------------------------------------


class TestBuildConversationMetricsResponse:
    """Tests for _build_conversation_metrics_response aggregation helper."""

    def test_empty_events_returns_zeroed_metrics(self) -> None:
        conv_id = str(uuid.uuid4())
        result = _build_conversation_metrics_response(conv_id, [])

        assert result.conversation_id == conv_id
        assert result.total_input_tokens == 0
        assert result.total_output_tokens == 0
        assert result.context_compaction_count == 0
        assert result.tool_call_counts == {}
        assert result.per_agent_metrics == {}
        assert result.sandbox_execution_time == 0.0

    def test_sums_tokens_from_llm_response_events(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "llm_response",
                {"usage": {"input_tokens": 100, "output_tokens": 50}},
                conversation_id=cid,
                event_id=1,
            ),
            _make_event(
                "llm_response",
                {"usage": {"input_tokens": 200, "output_tokens": 75}},
                conversation_id=cid,
                event_id=2,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.total_input_tokens == 300
        assert result.total_output_tokens == 125

    def test_counts_context_compacted_events(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "context_compacted",
                {"messages_before": 10, "messages_after": 5},
                conversation_id=cid,
                event_id=1,
            ),
            _make_event(
                "context_compacted",
                {"messages_before": 8, "messages_after": 4},
                conversation_id=cid,
                event_id=2,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.context_compaction_count == 2

    def test_counts_tool_calls_per_tool_name(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "tool_call",
                {"tool_name": "bash"},
                conversation_id=cid,
                event_id=1,
            ),
            _make_event(
                "tool_call",
                {"tool_name": "bash"},
                conversation_id=cid,
                event_id=2,
            ),
            _make_event(
                "tool_call",
                {"tool_name": "file_read"},
                conversation_id=cid,
                event_id=3,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.tool_call_counts == {"bash": 2, "file_read": 1}

    def test_collects_per_agent_metrics_from_agent_complete(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "agent_complete",
                {
                    "agent_name": "research step",
                    "metrics": {
                        "total_input_tokens": 500,
                        "total_output_tokens": 250,
                        "iterations": 3,
                    },
                },
                conversation_id=cid,
                event_id=1,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert "research step" in result.per_agent_metrics
        assert result.per_agent_metrics["research step"] == {
            "total_input_tokens": 500,
            "total_output_tokens": 250,
            "iterations": 3,
        }

    def test_handles_llm_response_missing_usage(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "llm_response",
                {"text": "hello"},
                conversation_id=cid,
                event_id=1,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.total_input_tokens == 0
        assert result.total_output_tokens == 0

    def test_handles_tool_call_missing_tool_name(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "tool_call",
                {"input": "ls -la"},
                conversation_id=cid,
                event_id=1,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        # Missing tool_name should be silently skipped
        assert result.tool_call_counts == {}

    def test_handles_agent_complete_missing_metrics(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "agent_complete",
                {"agent_name": "agent-x"},
                conversation_id=cid,
                event_id=1,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert "agent-x" in result.per_agent_metrics
        assert result.per_agent_metrics["agent-x"] == {}

    def test_uses_agent_id_fallback_when_agent_name_missing(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "agent_complete",
                {
                    "agent_id": "agent-fallback",
                    "metrics": {"iterations": 4},
                },
                conversation_id=cid,
                event_id=1,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.per_agent_metrics["agent-fallback"] == {"iterations": 4}

    def test_mixed_events_are_aggregated_correctly(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "llm_response",
                {"usage": {"input_tokens": 100, "output_tokens": 50}},
                conversation_id=cid,
                event_id=1,
            ),
            _make_event(
                "tool_call",
                {"tool_name": "bash"},
                conversation_id=cid,
                event_id=2,
            ),
            _make_event(
                "context_compacted",
                {},
                conversation_id=cid,
                event_id=3,
            ),
            _make_event(
                "llm_response",
                {"usage": {"input_tokens": 50, "output_tokens": 25}},
                conversation_id=cid,
                event_id=4,
            ),
            _make_event(
                "agent_complete",
                {
                    "agent_name": "main",
                    "metrics": {"total_input_tokens": 150, "iterations": 2},
                },
                conversation_id=cid,
                event_id=5,
            ),
            # Unrelated event type should be ignored
            _make_event(
                "turn_start",
                {"message": "hello"},
                conversation_id=cid,
                event_id=6,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.total_input_tokens == 150
        assert result.total_output_tokens == 75
        assert result.context_compaction_count == 1
        assert result.tool_call_counts == {"bash": 1}
        assert result.per_agent_metrics == {
            "main": {"total_input_tokens": 150, "iterations": 2}
        }

    def test_multiple_agents_tracked_separately(self) -> None:
        conv_id = str(uuid.uuid4())
        cid = uuid.UUID(conv_id)
        events = [
            _make_event(
                "agent_complete",
                {
                    "agent_name": "agent-a",
                    "metrics": {"iterations": 3},
                },
                conversation_id=cid,
                event_id=1,
            ),
            _make_event(
                "agent_complete",
                {
                    "agent_name": "agent-b",
                    "metrics": {"iterations": 5},
                },
                conversation_id=cid,
                event_id=2,
            ),
        ]
        result = _build_conversation_metrics_response(conv_id, events)

        assert result.per_agent_metrics["agent-a"] == {"iterations": 3}
        assert result.per_agent_metrics["agent-b"] == {"iterations": 5}


# ---------------------------------------------------------------------------
# Response model validation
# ---------------------------------------------------------------------------


class TestConversationMetricsResponse:
    """Tests for the ConversationMetricsResponse Pydantic model."""

    def test_model_defaults(self) -> None:
        m = ConversationMetricsResponse(
            conversation_id="abc",
            total_input_tokens=0,
            total_output_tokens=0,
            context_compaction_count=0,
        )
        assert m.tool_call_counts == {}
        assert m.per_agent_metrics == {}
        assert m.sandbox_execution_time == 0.0

    def test_model_with_values(self) -> None:
        m = ConversationMetricsResponse(
            conversation_id="test-id",
            total_input_tokens=1000,
            total_output_tokens=500,
            context_compaction_count=2,
            tool_call_counts={"bash": 3},
            per_agent_metrics={"agent-1": {"iterations": 4}},
            sandbox_execution_time=1.5,
        )
        assert m.conversation_id == "test-id"
        assert m.total_input_tokens == 1000
        assert m.total_output_tokens == 500
        assert m.context_compaction_count == 2
        assert m.tool_call_counts == {"bash": 3}
        assert m.per_agent_metrics == {"agent-1": {"iterations": 4}}
        assert m.sandbox_execution_time == 1.5


class TestPlannerModeFlag:
    def test_planner_flag_true_maps_to_planner_mode(self) -> None:
        assert _planner_flag_to_mode(True) == "planner"

    def test_planner_flag_false_maps_to_agent_mode(self) -> None:
        assert _planner_flag_to_mode(False) == "agent"

    def test_missing_planner_flag_keeps_existing_mode(self) -> None:
        assert _planner_flag_to_mode(None) is None


class TestResolveExecutionRoute:
    @pytest.mark.asyncio
    async def test_explicit_planner_forces_planner_mode_without_classifier(
        self,
    ) -> None:
        client = AsyncMock(spec=AnthropicClient)

        result = await _resolve_execution_route(client, "plan this work", True)

        assert result == (
            EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
            "planner forced by user",
            "planner",
            False,
        )
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_explicit_agent_forces_single_agent_without_classifier(self) -> None:
        client = AsyncMock(spec=AnthropicClient)

        result = await _resolve_execution_route(client, "keep this simple", False)

        assert result == (
            EXECUTION_SHAPE_SINGLE_AGENT,
            "planner disabled by user",
            "agent",
            False,
        )
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_unset_planner_flag_uses_classifier_and_auto_detects_planner(
        self,
    ) -> None:
        client = _mock_client("parallel|independent tasks")

        result = await _resolve_execution_route(
            client, "split this into independent tasks", None
        )

        assert result == (
            EXECUTION_SHAPE_PARALLEL,
            "independent tasks",
            "planner",
            True,
        )
        client.create_message.assert_called_once()


# ---------------------------------------------------------------------------
# Task complexity classifier
# ---------------------------------------------------------------------------


def _mock_client(response_text: str) -> AnthropicClient:
    client = AsyncMock(spec=AnthropicClient)
    client.create_message.return_value = LLMResponse(
        text=response_text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=10, output_tokens=2),
    )
    return client


class TestClassifyExecutionShape:
    @pytest.mark.asyncio
    async def test_single_agent_verdict_returns_shape(self) -> None:
        result = await _classify_execution_shape(
            _mock_client("single_agent|one owner"), "build a website"
        )
        assert result == (EXECUTION_SHAPE_SINGLE_AGENT, "one owner")

    @pytest.mark.asyncio
    async def test_prompt_chain_verdict_returns_shape(self) -> None:
        result = await _classify_execution_shape(
            _mock_client("prompt_chain|predictable sequence"),
            "prepare and then summarize",
        )
        assert result == (EXECUTION_SHAPE_PROMPT_CHAIN, "predictable sequence")

    @pytest.mark.asyncio
    async def test_parallel_verdict_case_insensitive(self) -> None:
        result = await _classify_execution_shape(
            _mock_client("PARALLEL|independent tasks"), "some task"
        )
        assert result == (EXECUTION_SHAPE_PARALLEL, "independent tasks")

    @pytest.mark.asyncio
    async def test_orchestrator_workers_verdict_returns_shape(self) -> None:
        result = await _classify_execution_shape(
            _mock_client("orchestrator_workers|open ended decomposition"), "some task"
        )
        assert result == (
            EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
            "open ended decomposition",
        )

    @pytest.mark.asyncio
    async def test_api_error_returns_single_agent_default(self) -> None:
        client = AsyncMock(spec=AnthropicClient)
        client.create_message.side_effect = RuntimeError("network failure")
        result = await _classify_execution_shape(client, "build a pipeline")
        assert result[0] == EXECUTION_SHAPE_SINGLE_AGENT

    @pytest.mark.asyncio
    async def test_ambiguous_response_returns_single_agent_default(self) -> None:
        result = await _classify_execution_shape(
            _mock_client("I cannot decide."), "some task"
        )
        assert result[0] == EXECUTION_SHAPE_SINGLE_AGENT

    @pytest.mark.asyncio
    async def test_uses_lite_model(self) -> None:
        client = _mock_client("single_agent|default")
        await _classify_execution_shape(client, "hello")
        call_kwargs = client.create_message.call_args.kwargs
        assert "model" in call_kwargs

    @pytest.mark.asyncio
    async def test_max_tokens_is_bounded(self) -> None:
        client = _mock_client("parallel|independent")
        await _classify_execution_shape(client, "build something")
        call_kwargs = client.create_message.call_args.kwargs
        assert call_kwargs.get("max_tokens", 999) <= 40

    @pytest.mark.asyncio
    async def test_long_message_is_truncated(self) -> None:
        client = _mock_client("single_agent|default")
        await _classify_execution_shape(client, "x" * 5000)
        call_kwargs = client.create_message.call_args.kwargs
        content = call_kwargs["messages"][0]["content"]
        assert len(content) <= 2000

    def test_execution_router_system_prompt_has_all_shapes(self) -> None:
        assert "single_agent" in _EXECUTION_ROUTER_SYSTEM_PROMPT
        assert "prompt_chain" in _EXECUTION_ROUTER_SYSTEM_PROMPT
        assert "parallel" in _EXECUTION_ROUTER_SYSTEM_PROMPT
        assert "orchestrator_workers" in _EXECUTION_ROUTER_SYSTEM_PROMPT
