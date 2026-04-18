"""Tests for the database event subscriber."""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from api.db_subscriber import PendingWrites, create_db_subscriber
from api.events import AgentEvent, EventType


def _make_event(
    event_type: EventType, data: dict, iteration: int | None = None
) -> AgentEvent:
    return AgentEvent(type=event_type, data=data, iteration=iteration)


@pytest.fixture
def repo():
    return AsyncMock()


@pytest.fixture
def session_factory():
    session = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    factory = MagicMock(return_value=cm)
    return factory


@pytest.fixture
def pending_writes():
    return PendingWrites()


# ---------------------------------------------------------------------------
# Basic event routing (unchanged behavior)
# ---------------------------------------------------------------------------


async def test_persists_turn_start_as_user_message(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TURN_START, {"message": "hello"})
    await subscriber(event)
    repo.save_message.assert_called_once()


async def test_persists_turn_start_attachments_in_user_message_content(
    repo, session_factory
) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(
        EventType.TURN_START,
        {
            "message": "inspect this file",
            "attachments": [
                {"name": "report.csv", "size": 12, "type": "text/csv"},
            ],
        },
    )

    await subscriber(event)

    args, kwargs = repo.save_message.call_args
    content = kwargs["content"] if "content" in kwargs else args[3]
    assert content == {
        "text": "inspect this file",
        "attachments": [{"name": "report.csv", "size": 12, "type": "text/csv"}],
    }


async def test_persists_turn_complete_as_assistant_message(
    repo, session_factory
) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TURN_COMPLETE, {"result": "done"})
    await subscriber(event)
    repo.save_message.assert_called_once()
    repo.update_conversation.assert_not_called()


async def test_persists_task_complete_message(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TASK_COMPLETE, {"summary": "all done"})
    await subscriber(event)
    repo.save_message.assert_called_once()
    repo.update_conversation.assert_not_called()


async def test_persists_generic_event(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TOOL_CALL, {"tool": "web_search"}, iteration=2)
    await subscriber(event)
    repo.save_event.assert_called_once()


async def test_skips_text_delta(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TEXT_DELTA, {"delta": "hello"})
    await subscriber(event)
    repo.save_event.assert_not_called()
    repo.save_message.assert_not_called()


async def test_ask_user_event_does_not_create_prompt_record(
    repo, session_factory
) -> None:
    conversation_id = uuid.uuid4()
    prompt_repo = AsyncMock()
    subscriber = create_db_subscriber(
        conversation_id,
        repo,
        session_factory,
        prompt_repo=prompt_repo,
    )
    event = _make_event(
        EventType.ASK_USER,
        {"question": "Need approval?", "request_id": "req_123"},
    )

    await subscriber(event)

    prompt_repo.create_prompt.assert_not_called()
    repo.save_event.assert_called_once()


async def test_updates_title_on_conversation_title_event(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.CONVERSATION_TITLE, {"title": "My Chat"})
    await subscriber(event)
    repo.update_conversation.assert_called_once()


async def test_persists_valid_artifact_created_event(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(
        EventType.ARTIFACT_CREATED,
        {
            "artifact_id": "a" * 32,
            "storage_key": "a" * 32 + ".html",
            "name": "paper-folding-demo.html",
            "content_type": "text/html",
            "size": 1024,
            "file_path": "/workspace/paper-folding-demo.html",
        },
    )

    await subscriber(event)

    repo.save_artifact.assert_called_once()
    repo.save_event.assert_called_once()


@patch("api.db_subscriber.logger.warning")
async def test_logs_and_skips_invalid_artifact_created_payload(
    mock_warning, repo, session_factory
) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(
        EventType.ARTIFACT_CREATED,
        {
            "artifact_id": "a" * 32,
            "name": "broken.html",
            "content_type": "text/html",
            "size": "not-a-number",
        },
    )

    await subscriber(event)

    repo.save_artifact.assert_not_called()
    repo.save_event.assert_called_once()
    mock_warning.assert_called_once()


@patch("api.db_subscriber.get_settings")
async def test_context_compacted_merges_summary(
    mock_get_settings, repo, session_factory
) -> None:
    mock_get_settings.return_value = MagicMock(
        COMPACT_CONTEXT_SUMMARY_MAX_CHARS=10_000,
        COMPACT_TOKEN_BUDGET=150_000,
        COMPACT_TOKEN_COUNTER="weighted",
        COMPACT_FULL_INTERACTIONS=5,
        COMPACT_FALLBACK_PREVIEW_CHARS=500,
        COMPACT_FALLBACK_RESULT_CHARS=1000,
        COMPACT_SUMMARY_MODEL="",
        COMPACT_FULL_DIALOGUE_TURNS=5,
        COMPACT_DIALOGUE_FALLBACK_CHARS=12_000,
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
        COMPACT_PLANNER_CONTEXT_SUMMARY_MAX_CHARS=7777,
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
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(
        EventType.CONTEXT_COMPACTED,
        {
            "original_messages": 10,
            "compacted_messages": 3,
            "summary_text": "## Earlier conversation\nkey point",
            "compaction_profile": "planner",
        },
    )
    await subscriber(event)
    repo.merge_conversation_context_summary.assert_called_once()
    args, _ = repo.merge_conversation_context_summary.call_args
    assert args[3] == 7777
    repo.save_event.assert_called_once()


@patch("api.db_subscriber.get_settings")
async def test_context_compacted_from_task_agent_does_not_merge_summary(
    mock_get_settings, repo, session_factory
) -> None:
    mock_get_settings.return_value = MagicMock(COMPACT_CONTEXT_SUMMARY_MAX_CHARS=10_000)
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(
        EventType.CONTEXT_COMPACTED,
        {
            "original_messages": 10,
            "compacted_messages": 3,
            "summary_text": "## Previous work\nworker scratchpad",
            "summary_scope": "task_agent",
            "agent_id": "worker-1",
        },
    )
    await subscriber(event)
    repo.merge_conversation_context_summary.assert_not_called()
    repo.save_event.assert_called_once()


# ---------------------------------------------------------------------------
# Retry behavior
# ---------------------------------------------------------------------------


@patch("api.db_subscriber.asyncio.sleep", new_callable=AsyncMock)
async def test_retries_on_operational_error(mock_sleep, repo, session_factory) -> None:
    """Transient failure should be retried up to _MAX_RETRIES times."""
    repo.save_event.side_effect = [
        OperationalError("conn lost", None, None),
        OperationalError("conn lost", None, None),
        None,  # succeeds on 3rd attempt
    ]
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TOOL_CALL, {"tool": "test"})

    await subscriber(event)

    assert repo.save_event.call_count == 3
    assert mock_sleep.call_count == 2  # slept between retries


@patch("api.db_subscriber.asyncio.sleep", new_callable=AsyncMock)
async def test_gives_up_after_max_retries(mock_sleep, repo, session_factory) -> None:
    """After exhausting retries, log error but don't raise."""
    repo.save_event.side_effect = OperationalError("conn lost", None, None)
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TOOL_CALL, {"tool": "test"})

    await subscriber(event)  # should not raise

    assert repo.save_event.call_count == 5


async def test_no_retry_on_integrity_error(repo, session_factory) -> None:
    """IntegrityError (duplicate key, etc.) should not be retried."""
    repo.save_event.side_effect = IntegrityError("dup key", None, None)
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TOOL_CALL, {"tool": "test"})

    await subscriber(event)  # should not raise

    assert repo.save_event.call_count == 1


async def test_db_failure_does_not_raise(repo, session_factory) -> None:
    """Unexpected exceptions still don't propagate to the agent loop."""
    repo.save_event.side_effect = RuntimeError("unexpected")
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.TOOL_CALL, {"tool": "test"})
    await subscriber(event)  # should not raise


# ---------------------------------------------------------------------------
# PendingWrites tracker
# ---------------------------------------------------------------------------


async def test_pending_writes_starts_drained(pending_writes) -> None:
    assert pending_writes.count == 0
    result = await pending_writes.wait_drained(timeout=0.1)
    assert result is True


async def test_pending_writes_tracks_increment_decrement(pending_writes) -> None:
    async with pending_writes.track():
        assert pending_writes.count == 1
    assert pending_writes.count == 0


async def test_pending_writes_drain_waits(pending_writes) -> None:
    """Verify wait_drained blocks until all tracked writes complete."""

    async with pending_writes.track():
        # Should timeout because we're still inside the tracked block
        result = await pending_writes.wait_drained(timeout=0.05)
        assert result is False

    # Now drained
    result = await pending_writes.wait_drained(timeout=0.1)
    assert result is True


async def test_pending_writes_passed_to_subscriber(
    repo, session_factory, pending_writes
) -> None:
    """When pending_writes is provided, writes are tracked."""
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(
        conversation_id, repo, session_factory, pending_writes
    )
    event = _make_event(EventType.TOOL_CALL, {"tool": "test"})
    await subscriber(event)
    # After completion, should be drained
    assert pending_writes.count == 0


async def test_pending_writes_serialize_background_event_persistence(
    repo, session_factory, pending_writes
) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(
        conversation_id,
        repo,
        session_factory,
        pending_writes,
    )
    first_started = asyncio.Event()
    first_release = asyncio.Event()
    second_started = asyncio.Event()
    active_writes = 0
    max_active_writes = 0
    persisted_tools: list[str] = []

    async def _save_event(
        session, conversation_id_arg, *, event_type, data, iteration=None
    ) -> None:
        del session, conversation_id_arg, event_type, iteration
        nonlocal active_writes, max_active_writes
        active_writes += 1
        max_active_writes = max(max_active_writes, active_writes)
        try:
            tool = str(data["tool"])
            persisted_tools.append(tool)
            if tool == "first":
                first_started.set()
                await first_release.wait()
            else:
                second_started.set()
        finally:
            active_writes -= 1

    repo.save_event.side_effect = _save_event

    await asyncio.gather(
        subscriber(_make_event(EventType.TOOL_CALL, {"tool": "first"})),
        subscriber(_make_event(EventType.TOOL_CALL, {"tool": "second"})),
    )

    await first_started.wait()
    await asyncio.sleep(0)
    assert second_started.is_set() is False

    first_release.set()
    assert await pending_writes.wait_drained(timeout=0.2) is True
    assert persisted_tools == ["first", "second"]
    assert max_active_writes == 1


# ---------------------------------------------------------------------------
# Token usage tracking
# ---------------------------------------------------------------------------


async def test_llm_response_increments_usage(repo, session_factory) -> None:
    """LLM_RESPONSE events should persist event and increment usage."""
    conversation_id = uuid.uuid4()
    user_id = uuid.uuid4()
    usage_repo = AsyncMock()
    subscriber = create_db_subscriber(
        conversation_id,
        repo,
        session_factory,
        user_id=user_id,
        usage_repo=usage_repo,
    )
    event = _make_event(
        EventType.LLM_RESPONSE,
        {
            "text": "hello",
            "usage": {"input_tokens": 150, "output_tokens": 50},
            "stop_reason": "end_turn",
        },
    )
    await subscriber(event)
    repo.save_event.assert_called_once()
    usage_repo.increment.assert_called_once_with(
        repo.save_event.call_args[0][0],  # session
        conversation_id,
        user_id,
        input_tokens=150,
        output_tokens=50,
    )


async def test_llm_response_skips_zero_usage(repo, session_factory) -> None:
    """LLM_RESPONSE with zero tokens should not call increment."""
    conversation_id = uuid.uuid4()
    usage_repo = AsyncMock()
    subscriber = create_db_subscriber(
        conversation_id,
        repo,
        session_factory,
        usage_repo=usage_repo,
    )
    event = _make_event(
        EventType.LLM_RESPONSE,
        {"text": "hi", "usage": {"input_tokens": 0, "output_tokens": 0}},
    )
    await subscriber(event)
    repo.save_event.assert_called_once()
    usage_repo.increment.assert_not_called()


async def test_llm_response_without_usage_repo(repo, session_factory) -> None:
    """LLM_RESPONSE should still persist event even without usage_repo."""
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(
        EventType.LLM_RESPONSE,
        {"text": "hi", "usage": {"input_tokens": 100, "output_tokens": 50}},
    )
    await subscriber(event)
    repo.save_event.assert_called_once()
