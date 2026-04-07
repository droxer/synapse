"""Tests for conversation metrics aggregation helper."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from agent.state.schemas import EventRecord

# The conversations module transitively imports api.auth which triggers
# ``get_settings()`` at module scope.  Provide dummy env vars so the import
# succeeds without real secrets.
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TAVILY_API_KEY", "test-key")

from api.models import ConversationMetricsResponse  # noqa: E402
from api.routes.conversations import _build_conversation_metrics_response  # noqa: E402


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
