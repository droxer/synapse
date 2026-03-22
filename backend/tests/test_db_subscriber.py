"""Tests for the database event subscriber."""

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


async def test_updates_title_on_conversation_title_event(repo, session_factory) -> None:
    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)
    event = _make_event(EventType.CONVERSATION_TITLE, {"title": "My Chat"})
    await subscriber(event)
    repo.update_conversation.assert_called_once()


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
