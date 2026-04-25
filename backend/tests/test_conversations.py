"""Tests for conversation metrics aggregation helper."""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from agent.state.schemas import ConversationRecord, EventRecord, MessageRecord

# The conversations module transitively imports api.auth which triggers
# ``get_settings()`` at module scope.  Provide dummy env vars so the import
# succeeds without real secrets.
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TAVILY_API_KEY", "test-key")

from agent.llm.client import AnthropicClient, LLMResponse, TokenUsage  # noqa: E402
from api.db_subscriber import create_db_subscriber  # noqa: E402
from api.models import ConversationEntry  # noqa: E402
from api.models import ConversationMetricsResponse  # noqa: E402
from api.models import MCPState  # noqa: E402
from api.routes.conversations import (  # noqa: E402
    _EXECUTION_ROUTER_SYSTEM_PROMPT,
    _elapsed_ms,
    _resolve_turn_locale,
    EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
    EXECUTION_SHAPE_PARALLEL,
    EXECUTION_SHAPE_PROMPT_CHAIN,
    EXECUTION_SHAPE_SINGLE_AGENT,
    ORCHESTRATOR_AGENT,
    ORCHESTRATOR_PLANNER,
    _build_conversation_metrics_response,
    _classify_execution_shape,
    _planner_flag_to_mode,
    _resolve_execution_route,
    create_conversation,
    get_conversation_events,
    get_conversation_messages,
    list_conversations,
    respond_to_prompt,
    send_message,
)
from api.events import EventEmitter  # noqa: E402
from api.models import UserInputRequest  # noqa: E402
import api.routes.conversations as conversation_routes  # noqa: E402
from api.user_responses import SubmitResponseStatus  # noqa: E402


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


def test_elapsed_ms_rounds_down_to_integer_milliseconds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(conversation_routes.time, "perf_counter", lambda: 10.9876)
    assert _elapsed_ms(10.1234) == 864


@pytest.mark.asyncio
async def test_list_conversations_includes_orchestrator_mode() -> None:
    now = datetime.now(timezone.utc)
    conversation_id = uuid.uuid4()
    record = ConversationRecord(
        id=conversation_id,
        user_id=None,
        title="Planner task",
        orchestrator_mode=ORCHESTRATOR_PLANNER,
        context_summary=None,
        created_at=now,
        updated_at=now,
    )
    state = SimpleNamespace(
        db_repo=SimpleNamespace(
            list_conversations=AsyncMock(return_value=([record], 1)),
        ),
    )

    response = await list_conversations(
        request=SimpleNamespace(),
        state=state,
        session=object(),
        auth_user=None,
    )

    assert response["items"][0]["orchestrator_mode"] == ORCHESTRATOR_PLANNER


@pytest.mark.asyncio
async def test_parse_uploads_enforces_aggregate_size_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(conversation_routes, "_MAX_TOTAL_UPLOAD_SIZE_MB", 1)
    monkeypatch.setattr(conversation_routes, "_UPLOAD_READ_CHUNK_SIZE", 512 * 1024)

    class _Upload:
        filename = "large.bin"
        content_type = "application/octet-stream"

        def __init__(self) -> None:
            self._chunks = [b"x" * (512 * 1024), b"x" * (512 * 1024), b"x"]

        async def read(self, size: int = -1) -> bytes:
            del size
            if not self._chunks:
                return b""
            return self._chunks.pop(0)

    with pytest.raises(HTTPException) as exc_info:
        await conversation_routes._parse_uploads([_Upload()])

    assert exc_info.value.status_code == 400
    assert "aggregate limit" in str(exc_info.value.detail)


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


class _DummyRequest:
    def __init__(
        self,
        payload: dict[str, object],
        *,
        cookies: dict[str, str] | None = None,
    ) -> None:
        self.headers = {"content-type": "application/json"}
        self._payload = payload
        self.cookies = cookies or {}

    async def json(self) -> dict[str, object]:
        return self._payload


def _build_conversation_entry(orchestrator: object) -> ConversationEntry:
    return ConversationEntry(
        emitter=EventEmitter(),
        event_queue=asyncio.Queue(),
        orchestrator=orchestrator,  # type: ignore[arg-type]
        executor=AsyncMock(),
        pending_callbacks={},
        orchestrator_mode=ORCHESTRATOR_AGENT,
    )


class TestCreateConversationBootstrap:
    @pytest.mark.asyncio
    async def test_create_conversation_defers_classification_to_background_task(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Execution route classification is deferred to the background turn
        task so the HTTP response returns immediately."""
        scheduled: list[object] = []

        def _fake_create_task(coro: object) -> SimpleNamespace:
            scheduled.append(coro)
            return SimpleNamespace(done=lambda: False, cancel=lambda: None)

        @asynccontextmanager
        async def _session_factory():
            yield object()

        state = SimpleNamespace(
            db_session_factory=_session_factory,
            db_repo=SimpleNamespace(
                create_conversation=AsyncMock(),
            ),
            db_pending_writes=object(),
            skill_repo=None,
            usage_repo=None,
            conversations={},
            claude_client=object(),
            sandbox_provider=object(),
            storage_backend=object(),
            mcp_state=None,
        )

        resolve_route = AsyncMock(
            return_value=(
                EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
                "open ended decomposition",
                ORCHESTRATOR_PLANNER,
                True,
            )
        )
        monkeypatch.setattr(
            conversation_routes, "_resolve_execution_route", resolve_route
        )
        monkeypatch.setattr(
            conversation_routes,
            "create_db_subscriber",
            lambda *args, **kwargs: AsyncMock(),
        )
        monkeypatch.setattr(
            conversation_routes.asyncio, "create_task", _fake_create_task
        )

        response = await create_conversation(
            _DummyRequest({"message": "hello"}), state=state, auth_user=None
        )

        assert response.conversation_id
        assert response.conversation_id in state.conversations
        assert state.db_repo.create_conversation.await_count == 1
        # Classification is deferred — entry starts with default mode
        assert (
            state.conversations[response.conversation_id].orchestrator_mode
            == ORCHESTRATOR_AGENT
        )
        # _resolve_execution_route is NOT called during the request handler
        assert resolve_route.await_count == 0
        assert len(scheduled) == 2

        for coro in scheduled:
            close = getattr(coro, "close", None)
            if callable(close):
                close()

    @pytest.mark.asyncio
    async def test_create_conversation_defers_planner_auto_selected_to_background(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The planner_auto_selected event is emitted by the background
        bootstrap task (not the request handler) since execution route
        classification is now deferred."""
        scheduled_coros: list[object] = []

        @asynccontextmanager
        async def _session_factory():
            yield object()

        state = SimpleNamespace(
            db_session_factory=_session_factory,
            db_repo=SimpleNamespace(
                create_conversation=AsyncMock(),
            ),
            db_pending_writes=object(),
            skill_repo=None,
            usage_repo=None,
            conversations={},
            claude_client=object(),
            sandbox_provider=object(),
            storage_backend=object(),
            mcp_state=None,
        )

        monkeypatch.setattr(
            conversation_routes,
            "_resolve_execution_route",
            AsyncMock(
                return_value=(
                    EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
                    "open ended decomposition",
                    ORCHESTRATOR_PLANNER,
                    True,
                )
            ),
        )
        monkeypatch.setattr(
            conversation_routes,
            "create_db_subscriber",
            lambda *args, **kwargs: AsyncMock(),
        )

        def _fake_start_turn_task(
            entry: ConversationEntry,
            coro: object,
            *,
            idempotency_key: str | None = None,
        ) -> None:
            del idempotency_key
            scheduled_coros.append(coro)

        monkeypatch.setattr(
            conversation_routes, "_start_turn_task", _fake_start_turn_task
        )

        def _fake_create_task(coro: object) -> SimpleNamespace:
            close = getattr(coro, "close", None)
            if callable(close):
                close()
            return SimpleNamespace(done=lambda: False, cancel=lambda: None)

        monkeypatch.setattr(
            conversation_routes.asyncio,
            "create_task",
            _fake_create_task,
        )

        response = await create_conversation(
            _DummyRequest({"message": "hello"}), state=state, auth_user=None
        )

        # The event queue should be empty at request time — the
        # planner_auto_selected event is emitted later in the bootstrap.
        entry = state.conversations[response.conversation_id]
        assert entry.event_queue.empty()

        for coro in scheduled_coros:
            close = getattr(coro, "close", None)
            if callable(close):
                close()


class TestConversationMemoryLoading:
    @pytest.mark.asyncio
    async def test_reconstruct_conversation_uses_initial_memory_limit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        conversation_id = str(uuid.uuid4())
        conv_uuid = uuid.UUID(conversation_id)
        user_id = uuid.uuid4()
        load_limits: list[int] = []

        class _FakePersistentStore:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs

            async def load_all(self, limit: int = 100) -> list[dict[str, str]]:
                load_limits.append(limit)
                return []

        state = SimpleNamespace(
            db_session_factory=_noop_session_factory,
            db_repo=SimpleNamespace(
                get_conversation=AsyncMock(
                    return_value=SimpleNamespace(
                        id=conv_uuid,
                        user_id=user_id,
                        orchestrator_mode=ORCHESTRATOR_AGENT,
                        context_summary=None,
                    )
                ),
            ),
            db_pending_writes=None,
            skill_repo=None,
            usage_repo=None,
            response_coordinator=None,
            claude_client=object(),
            sandbox_provider=object(),
            storage_backend=object(),
            mcp_state=None,
            conversations={},
        )

        monkeypatch.setattr(
            conversation_routes,
            "PersistentMemoryStore",
            _FakePersistentStore,
        )
        monkeypatch.setattr(
            conversation_routes,
            "get_settings",
            lambda: SimpleNamespace(INITIAL_CONVERSATION_MEMORY_LIMIT=7),
        )
        monkeypatch.setattr(
            conversation_routes,
            "resolve_compaction_profile",
            lambda settings, runtime: SimpleNamespace(),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_build_user_skill_registry",
            AsyncMock(return_value=None),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_load_initial_messages_for_conversation",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_build_orchestrator",
            lambda *args, **kwargs: (object(), object()),
        )
        monkeypatch.setattr(
            conversation_routes,
            "create_db_subscriber",
            lambda *args, **kwargs: AsyncMock(),
        )

        await conversation_routes._reconstruct_conversation(state, conversation_id)

        assert load_limits == [7]

    @pytest.mark.asyncio
    async def test_mode_switch_rebuild_uses_initial_memory_limit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        conversation_id = str(uuid.uuid4())
        conv_uuid = uuid.UUID(conversation_id)
        user_id = uuid.uuid4()
        load_limits: list[int] = []

        class _FakePersistentStore:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs

            async def load_all(self, limit: int = 100) -> list[dict[str, str]]:
                load_limits.append(limit)
                return []

        planner_orchestrator = AsyncMock()
        planner_orchestrator.run.return_value = "ok"
        entry = _build_conversation_entry(AsyncMock())
        state = SimpleNamespace(
            conversations={conversation_id: entry},
            claude_client=object(),
            db_session_factory=_noop_session_factory,
            db_repo=SimpleNamespace(
                get_conversation=AsyncMock(
                    return_value=SimpleNamespace(
                        id=conv_uuid,
                        user_id=user_id,
                        orchestrator_mode=ORCHESTRATOR_AGENT,
                        context_summary=None,
                    )
                ),
                update_conversation=AsyncMock(),
            ),
            sandbox_provider=object(),
            storage_backend=object(),
            mcp_state=None,
        )

        monkeypatch.setattr(
            conversation_routes,
            "PersistentMemoryStore",
            _FakePersistentStore,
        )
        monkeypatch.setattr(
            conversation_routes,
            "get_settings",
            lambda: SimpleNamespace(
                INITIAL_CONVERSATION_MEMORY_LIMIT=7,
                EXECUTION_SHAPE_ORCHESTRATOR_WORKERS_SOFT_LIMIT=4,
            ),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_resolve_execution_route",
            AsyncMock(
                return_value=(
                    EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
                    "planner requested",
                    ORCHESTRATOR_PLANNER,
                    False,
                )
            ),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_build_user_skill_registry",
            AsyncMock(return_value=None),
        )
        monkeypatch.setattr(
            conversation_routes,
            "resolve_compaction_profile",
            lambda settings, runtime: SimpleNamespace(),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_load_initial_messages_for_conversation",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            conversation_routes,
            "_build_planner_orchestrator",
            lambda *args, **kwargs: (planner_orchestrator, AsyncMock()),
        )

        request = _DummyRequest(
            {
                "message": "plan this with workers",
                "planner": True,
                "skills": [],
            }
        )

        await send_message(
            request,
            conversation_id=conversation_id,
            state=state,
            auth_user=None,
        )

        if entry.turn_task is not None:
            await entry.turn_task

        assert load_limits == [7]


class TestResolveTurnLocale:
    @pytest.mark.asyncio
    async def test_uses_persisted_user_locale_before_cookie(self) -> None:
        @asynccontextmanager
        async def _session_factory():
            yield object()

        request = _DummyRequest({"message": "hello"}, cookies={"synapse-locale": "en"})
        state = SimpleNamespace(
            db_session_factory=_session_factory,
            user_repo=SimpleNamespace(
                find_by_id=AsyncMock(return_value=SimpleNamespace(locale="zh-CN"))
            ),
        )

        locale = await _resolve_turn_locale(
            request,
            state,
            auth_user=None,
            user_id=uuid.uuid4(),
        )

        assert locale == "zh-CN"

    @pytest.mark.asyncio
    async def test_falls_back_to_locale_cookie_for_anonymous_turns(self) -> None:
        request = _DummyRequest(
            {"message": "hello"}, cookies={"synapse-locale": "zh-TW"}
        )
        state = SimpleNamespace()

        locale = await _resolve_turn_locale(
            request,
            state,
            auth_user=None,
        )

        assert locale == "zh-TW"


class _ConcurrentOrchestrator:
    def __init__(self) -> None:
        self.calls = 0
        self.active = 0
        self.max_active = 0
        self.first_release = asyncio.Event()

    async def run(
        self,
        user_message: str,
        attachments: tuple[object, ...] = (),
        selected_skills: tuple[str, ...] = (),
        runtime_prompt_sections: tuple[str, ...] = (),
        turn_metadata: dict[str, object] | None = None,
    ) -> str:
        del attachments, selected_skills, runtime_prompt_sections, turn_metadata
        self.calls += 1
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.calls == 1:
                await self.first_release.wait()
            else:
                await asyncio.sleep(0.01)
            return f"done:{user_message}"
        finally:
            self.active -= 1


@asynccontextmanager
async def _noop_session_factory():
    yield object()


@pytest.mark.asyncio
async def test_prepare_conversation_runtime_schedules_mcp_restore_without_blocking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    order: list[str] = []
    restored_registry = object()
    mcp_state = MCPState()

    class _FakePersistentStore:
        def __init__(self, *args, **kwargs) -> None:
            del args, kwargs

        async def load_all(self, limit: int = 100) -> list[dict[str, str]]:
            del limit
            await asyncio.sleep(0)
            order.append("memory")
            return []

    async def _fake_restore(
        state: MCPState,
        session_factory: object,
        *,
        conversation_id: str,
        user_id: uuid.UUID,
    ) -> None:
        del session_factory, conversation_id, user_id
        await asyncio.sleep(0.05)
        state.registry = restored_registry  # type: ignore[assignment]
        order.append("restore")
        restore_done.set()

    async def _fake_skill_registry(state: object, user_id: uuid.UUID) -> None:
        del state, user_id
        await asyncio.sleep(0)
        order.append("skills")

    restore_done = asyncio.Event()

    def _fake_build_orchestrator(*args, **kwargs) -> tuple[object, object]:
        del args
        order.append("build")
        assert "restore" not in order
        assert kwargs["mcp_state"] is mcp_state
        return object(), object()

    state = SimpleNamespace(
        claude_client=object(),
        db_session_factory=_noop_session_factory,
        sandbox_provider=object(),
        storage_backend=object(),
        mcp_state=mcp_state,
    )

    monkeypatch.setattr(
        conversation_routes, "PersistentMemoryStore", _FakePersistentStore
    )
    monkeypatch.setattr(
        conversation_routes,
        "get_settings",
        lambda: SimpleNamespace(INITIAL_CONVERSATION_MEMORY_LIMIT=7),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_restore_mcp_servers_background",
        _fake_restore,
    )
    monkeypatch.setattr(
        conversation_routes,
        "_build_user_skill_registry",
        _fake_skill_registry,
    )
    monkeypatch.setattr(
        conversation_routes,
        "_build_orchestrator",
        _fake_build_orchestrator,
    )

    await conversation_routes._prepare_conversation_runtime(
        state,
        conversation_id=str(uuid.uuid4()),
        conv_uuid=uuid.uuid4(),
        user_id=uuid.uuid4(),
        mode=ORCHESTRATOR_AGENT,
        emitter=EventEmitter(),
    )

    assert order[-1] == "build"
    await asyncio.wait_for(restore_done.wait(), timeout=1)
    assert order[-1] == "restore"


def _build_state_with_entry(
    conversation_id: str,
    entry: ConversationEntry,
) -> SimpleNamespace:
    return SimpleNamespace(
        conversations={conversation_id: entry},
        claude_client=object(),
        db_session_factory=_noop_session_factory,
        db_repo=SimpleNamespace(update_conversation=AsyncMock()),
    )


@pytest.mark.asyncio
async def test_get_conversation_messages_returns_only_terminal_assistant_history() -> (
    None
):
    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    now = datetime.now(timezone.utc)
    session = object()

    class _RecordingRepo:
        def __init__(self) -> None:
            self.messages: list[MessageRecord] = []

        async def save_message(
            self,
            session: object,
            conversation_id: uuid.UUID,
            role: str,
            content: dict[str, object],
            iteration: int | None = None,
        ) -> MessageRecord:
            del session
            record = MessageRecord(
                id=uuid.uuid4(),
                conversation_id=conversation_id,
                role=role,
                content=content,
                iteration=iteration,
                created_at=now,
            )
            self.messages.append(record)
            return record

        async def save_event(
            self,
            session: object,
            conversation_id: uuid.UUID,
            event_type: str,
            data: dict[str, object],
            iteration: int | None = None,
            timestamp: datetime | None = None,
        ) -> None:
            del session, conversation_id, event_type, data, iteration, timestamp

        async def get_conversation(
            self, session: object, conversation_id: uuid.UUID
        ) -> SimpleNamespace:
            del session
            return SimpleNamespace(id=conversation_id, title="Chat")

        async def get_messages(
            self,
            session: object,
            conversation_id: uuid.UUID,
            limit: int | None = None,
            offset: int = 0,
        ) -> list[MessageRecord]:
            del session
            messages = [
                message
                for message in self.messages
                if message.conversation_id == conversation_id
            ]
            if limit is None:
                return messages[offset:]
            return messages[offset : offset + limit]

    @asynccontextmanager
    async def _session_factory():
        yield session

    repo = _RecordingRepo()
    subscriber = create_db_subscriber(conv_uuid, repo, _session_factory)

    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TURN_START,
            data={"message": "hello"},
            iteration=None,
            timestamp=now.timestamp(),
        )
    )
    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.MESSAGE_USER,
            data={"message": "draft answer"},
            iteration=1,
            timestamp=now.timestamp(),
        )
    )
    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TURN_COMPLETE,
            data={"result": "final answer"},
            iteration=1,
            timestamp=now.timestamp(),
        )
    )

    state = SimpleNamespace(db_repo=repo)

    payload = await get_conversation_messages(
        conversation_id=conversation_id,
        session=session,
        state=state,
        auth_user=None,
    )

    assert payload["conversation_id"] == conversation_id
    assert [message["role"] for message in payload["messages"]] == [
        "user",
        "assistant",
    ]
    assert payload["messages"][1]["content"] == {"text": "final answer"}


@pytest.mark.asyncio
async def test_get_conversation_messages_skips_task_complete_assistant_row() -> None:
    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    now = datetime.now(timezone.utc)
    session = object()

    class _RecordingRepo:
        def __init__(self) -> None:
            self.messages: list[MessageRecord] = []

        async def save_message(
            self,
            session: object,
            conversation_id: uuid.UUID,
            role: str,
            content: dict[str, object],
            iteration: int | None = None,
        ) -> MessageRecord:
            del session
            record = MessageRecord(
                id=uuid.uuid4(),
                conversation_id=conversation_id,
                role=role,
                content=content,
                iteration=iteration,
                created_at=now,
            )
            self.messages.append(record)
            return record

        async def save_event(
            self,
            session: object,
            conversation_id: uuid.UUID,
            event_type: str,
            data: dict[str, object],
            iteration: int | None = None,
            timestamp: datetime | None = None,
        ) -> None:
            del session, conversation_id, event_type, data, iteration, timestamp

        async def get_conversation(
            self, session: object, conversation_id: uuid.UUID
        ) -> SimpleNamespace:
            del session
            return SimpleNamespace(id=conversation_id, title="Chat")

        async def get_messages(
            self,
            session: object,
            conversation_id: uuid.UUID,
            limit: int | None = None,
            offset: int = 0,
        ) -> list[MessageRecord]:
            del session
            messages = [
                message
                for message in self.messages
                if message.conversation_id == conversation_id
            ]
            if limit is None:
                return messages[offset:]
            return messages[offset : offset + limit]

    @asynccontextmanager
    async def _session_factory():
        yield session

    repo = _RecordingRepo()
    subscriber = create_db_subscriber(conv_uuid, repo, _session_factory)

    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TURN_START,
            data={"message": "hello"},
            iteration=None,
            timestamp=now.timestamp(),
        )
    )
    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TASK_COMPLETE,
            data={"summary": "task summary"},
            iteration=1,
            timestamp=now.timestamp(),
        )
    )
    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TURN_COMPLETE,
            data={"result": "final answer"},
            iteration=1,
            timestamp=now.timestamp(),
        )
    )

    state = SimpleNamespace(db_repo=repo)

    payload = await get_conversation_messages(
        conversation_id=conversation_id,
        session=session,
        state=state,
        auth_user=None,
    )

    assert [message["role"] for message in payload["messages"]] == [
        "user",
        "assistant",
    ]
    assert payload["messages"][1]["content"] == {"text": "final answer"}


@pytest.mark.asyncio
async def test_get_conversation_events_returns_persisted_turn_start() -> None:
    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    now = datetime.now(timezone.utc)
    session = object()

    class _RecordingRepo:
        def __init__(self) -> None:
            self.messages: list[MessageRecord] = []
            self.events: list[EventRecord] = []

        async def save_message(
            self,
            session: object,
            conversation_id: uuid.UUID,
            role: str,
            content: dict[str, object],
            iteration: int | None = None,
        ) -> MessageRecord:
            del session
            record = MessageRecord(
                id=uuid.uuid4(),
                conversation_id=conversation_id,
                role=role,
                content=content,
                iteration=iteration,
                created_at=now,
            )
            self.messages.append(record)
            return record

        async def save_event(
            self,
            session: object,
            conversation_id: uuid.UUID,
            event_type: str,
            data: dict[str, object],
            iteration: int | None = None,
            timestamp: datetime | None = None,
        ) -> EventRecord:
            del session
            record = EventRecord(
                id=len(self.events) + 1,
                conversation_id=conversation_id,
                event_type=event_type,
                data=data,
                iteration=iteration,
                timestamp=timestamp or now,
            )
            self.events.append(record)
            return record

        async def get_conversation(
            self, session: object, conversation_id: uuid.UUID
        ) -> SimpleNamespace:
            del session
            return SimpleNamespace(id=conversation_id, title="Chat")

        async def get_events(
            self,
            session: object,
            conversation_id: uuid.UUID,
            limit: int = 500,
            offset: int = 0,
        ) -> list[EventRecord]:
            del session
            matching = [
                event
                for event in self.events
                if event.conversation_id == conversation_id
            ]
            return matching[offset : offset + limit]

        async def get_latest_events(
            self,
            session: object,
            conversation_id: uuid.UUID,
            limit: int,
            offset: int = 0,
        ) -> list[EventRecord]:
            return await self.get_events(session, conversation_id, limit, offset)

    @asynccontextmanager
    async def _session_factory():
        yield session

    repo = _RecordingRepo()
    subscriber = create_db_subscriber(conv_uuid, repo, _session_factory)

    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TURN_START,
            data={
                "message": "hello",
                "attachments": [{"name": "report.csv", "size": 42, "type": "text/csv"}],
            },
            iteration=None,
            timestamp=now.timestamp(),
        )
    )
    await subscriber(
        conversation_routes.AgentEvent(
            type=conversation_routes.EventType.TURN_COMPLETE,
            data={"result": "final answer"},
            iteration=1,
            timestamp=now.timestamp(),
        )
    )

    state = SimpleNamespace(db_repo=repo)

    payload = await get_conversation_events(
        conversation_id=conversation_id,
        session=session,
        state=state,
        auth_user=None,
    )

    assert [event["type"] for event in payload["events"]] == [
        "turn_start",
        "turn_complete",
    ]
    assert payload["events"][0]["data"] == {
        "message": "hello",
        "attachments": [{"name": "report.csv", "size": 42, "type": "text/csv"}],
    }


@pytest.mark.asyncio
async def test_get_conversation_events_latest_page_includes_late_pending_ask() -> None:
    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    session = object()
    base_time = datetime.now(timezone.utc)
    events = [
        EventRecord(
            id=index + 1,
            conversation_id=conv_uuid,
            event_type="tool_call",
            data={"index": index},
            iteration=index,
            timestamp=base_time,
        )
        for index in range(520)
    ]
    events.append(
        EventRecord(
            id=521,
            conversation_id=conv_uuid,
            event_type="ask_user",
            data={"request_id": "req_late", "question": "Still there?"},
            iteration=521,
            timestamp=base_time,
        )
    )

    class _RecordingRepo:
        async def get_conversation(
            self, session: object, conversation_id: uuid.UUID
        ) -> SimpleNamespace:
            del session
            return SimpleNamespace(id=conversation_id, title="Chat")

        async def get_latest_events(
            self,
            session: object,
            conversation_id: uuid.UUID,
            limit: int,
            offset: int = 0,
        ) -> list[EventRecord]:
            del session
            matching = [
                event for event in events if event.conversation_id == conversation_id
            ]
            return matching[-(offset + limit) : len(matching) - offset]

        async def get_events(
            self,
            session: object,
            conversation_id: uuid.UUID,
            limit: int = 500,
            offset: int = 0,
        ) -> list[EventRecord]:
            del session
            matching = [
                event for event in events if event.conversation_id == conversation_id
            ]
            return matching[offset : offset + limit]

    state = SimpleNamespace(db_repo=_RecordingRepo())

    payload = await get_conversation_events(
        conversation_id=conversation_id,
        limit=500,
        latest=True,
        session=session,
        state=state,
        auth_user=None,
    )

    assert len(payload["events"]) == 500
    assert payload["events"][-1]["type"] == "ask_user"
    assert payload["events"][-1]["data"]["request_id"] == "req_late"


@pytest.mark.asyncio
async def test_respond_to_prompt_returns_conflict_for_answered_prompt() -> None:
    class _Coordinator:
        async def submit_response(
            self,
            *,
            conversation_id: str,
            request_id: str,
            response: str,
        ) -> SimpleNamespace:
            del conversation_id, request_id, response
            return SimpleNamespace(status=SubmitResponseStatus.ALREADY_RESPONDED)

    state = SimpleNamespace(response_coordinator=_Coordinator(), conversations={})

    with pytest.raises(HTTPException) as exc_info:
        await respond_to_prompt(
            UserInputRequest(request_id="req_answered", response="second answer"),
            conversation_id=str(uuid.uuid4()),
            state=state,
            auth_user=None,
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_send_message_deduplicates_same_inflight_idempotency_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = str(uuid.uuid4())
    orchestrator = _ConcurrentOrchestrator()
    entry = _build_conversation_entry(orchestrator)
    state = _build_state_with_entry(conversation_id, entry)

    monkeypatch.setattr(
        conversation_routes,
        "_resolve_execution_route",
        AsyncMock(
            return_value=(
                EXECUTION_SHAPE_SINGLE_AGENT,
                "default",
                ORCHESTRATOR_AGENT,
                False,
            )
        ),
    )

    request = _DummyRequest(
        {"message": "hello", "idempotency_key": "same-key", "skills": []}
    )

    await asyncio.gather(
        send_message(
            request, conversation_id=conversation_id, state=state, auth_user=None
        ),
        send_message(
            request, conversation_id=conversation_id, state=state, auth_user=None
        ),
    )

    orchestrator.first_release.set()
    await entry.turn_task

    assert orchestrator.calls == 1


@pytest.mark.asyncio
async def test_send_message_serializes_distinct_concurrent_turns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = str(uuid.uuid4())
    orchestrator = _ConcurrentOrchestrator()
    entry = _build_conversation_entry(orchestrator)
    state = _build_state_with_entry(conversation_id, entry)

    monkeypatch.setattr(
        conversation_routes,
        "_resolve_execution_route",
        AsyncMock(
            return_value=(
                EXECUTION_SHAPE_SINGLE_AGENT,
                "default",
                ORCHESTRATOR_AGENT,
                False,
            )
        ),
    )

    first_request = _DummyRequest(
        {"message": "first", "idempotency_key": "key-1", "skills": []}
    )
    second_request = _DummyRequest(
        {"message": "second", "idempotency_key": "key-2", "skills": []}
    )

    first_task = asyncio.create_task(
        send_message(
            first_request,
            conversation_id=conversation_id,
            state=state,
            auth_user=None,
        )
    )
    second_task = asyncio.create_task(
        send_message(
            second_request,
            conversation_id=conversation_id,
            state=state,
            auth_user=None,
        )
    )

    while orchestrator.calls == 0:
        await asyncio.sleep(0)
    assert orchestrator.calls == 1
    assert second_task.done() is False

    orchestrator.first_release.set()
    await asyncio.gather(first_task, second_task)
    await entry.turn_task

    assert orchestrator.calls == 2
    assert orchestrator.max_active == 1


@pytest.mark.asyncio
async def test_send_message_emits_planner_auto_selected_before_starting_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = str(uuid.uuid4())
    started_with_event_types: list[str] = []
    entry = _build_conversation_entry(AsyncMock())
    entry.subscriber = conversation_routes._create_queue_subscriber(  # noqa: SLF001
        entry.event_queue,
        entry.pending_callbacks,
    )
    entry.emitter.subscribe(entry.subscriber)
    state = _build_state_with_entry(conversation_id, entry)
    state.db_repo.get_conversation = AsyncMock(
        return_value=SimpleNamespace(
            id=uuid.UUID(conversation_id),
            user_id=None,
            orchestrator_mode=ORCHESTRATOR_AGENT,
            context_summary=None,
        )
    )
    state.sandbox_provider = object()
    state.storage_backend = object()
    state.mcp_state = None

    monkeypatch.setattr(
        conversation_routes,
        "_resolve_execution_route",
        AsyncMock(
            return_value=(
                EXECUTION_SHAPE_PARALLEL,
                "independent tasks",
                ORCHESTRATOR_PLANNER,
                True,
            )
        ),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_build_user_skill_registry",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_load_runtime_memory_entries",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_load_initial_messages_for_conversation",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_build_planner_orchestrator",
        lambda *args, **kwargs: (AsyncMock(), AsyncMock()),
    )
    monkeypatch.setattr(
        conversation_routes,
        "resolve_compaction_profile",
        lambda settings, runtime: SimpleNamespace(),
    )

    def _fake_start_turn_task(
        current_entry: ConversationEntry,
        coro: object,
        *,
        idempotency_key: str | None = None,
    ) -> None:
        del idempotency_key
        try:
            first_event = current_entry.event_queue.get_nowait()
            started_with_event_types.append(first_event.type.value)
        except asyncio.QueueEmpty:
            started_with_event_types.append("missing")
        close = getattr(coro, "close", None)
        if callable(close):
            close()

    monkeypatch.setattr(conversation_routes, "_start_turn_task", _fake_start_turn_task)

    await send_message(
        _DummyRequest({"message": "split this into parallel workers", "skills": []}),
        conversation_id=conversation_id,
        state=state,
        auth_user=None,
    )

    assert started_with_event_types == ["planner_auto_selected"]


@pytest.mark.asyncio
async def test_send_message_reuses_existing_mode_without_router(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = str(uuid.uuid4())
    orchestrator = AsyncMock()
    orchestrator.run.return_value = "ok"
    entry = _build_conversation_entry(orchestrator)
    state = _build_state_with_entry(conversation_id, entry)
    resolve_route = AsyncMock()

    monkeypatch.setattr(conversation_routes, "_resolve_execution_route", resolve_route)

    await send_message(
        _DummyRequest({"message": "hello again", "skills": []}),
        conversation_id=conversation_id,
        state=state,
        auth_user=None,
    )

    if entry.turn_task is not None:
        await entry.turn_task

    resolve_route.assert_not_awaited()
    orchestrator.run.assert_awaited_once()


@pytest.mark.asyncio
async def test_send_message_routes_when_follow_up_has_planner_cue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = str(uuid.uuid4())
    entry = _build_conversation_entry(AsyncMock())
    state = _build_state_with_entry(conversation_id, entry)
    resolve_route = AsyncMock(
        return_value=(
            EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
            "planner requested",
            ORCHESTRATOR_PLANNER,
            False,
        )
    )

    monkeypatch.setattr(conversation_routes, "_resolve_execution_route", resolve_route)
    monkeypatch.setattr(
        conversation_routes,
        "_build_user_skill_registry",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_load_runtime_memory_entries",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_load_initial_messages_for_conversation",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        conversation_routes,
        "_build_planner_orchestrator",
        lambda *args, **kwargs: (AsyncMock(), AsyncMock()),
    )
    monkeypatch.setattr(
        conversation_routes,
        "resolve_compaction_profile",
        lambda settings, runtime: SimpleNamespace(),
    )
    state.db_repo.get_conversation = AsyncMock(
        return_value=SimpleNamespace(
            id=uuid.UUID(conversation_id),
            user_id=None,
            orchestrator_mode=ORCHESTRATOR_AGENT,
            context_summary=None,
        )
    )
    state.sandbox_provider = object()
    state.storage_backend = object()
    state.mcp_state = None

    await send_message(
        _DummyRequest({"message": "break this down into workers", "skills": []}),
        conversation_id=conversation_id,
        state=state,
        auth_user=None,
    )

    resolve_route.assert_awaited_once()
