"""Tests for state DTO schemas."""

import uuid
from datetime import datetime, timezone

import pytest

from agent.state.schemas import (
    AgentRunRecord,
    ConversationRecord,
    EventRecord,
    MessageRecord,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TestConversationRecord:
    def test_frozen(self) -> None:
        record = ConversationRecord(
            id=uuid.uuid4(),
            user_id=None,
            title="Test",
            orchestrator_mode="agent",
            context_summary=None,
            created_at=_now(),
            updated_at=_now(),
        )
        with pytest.raises(AttributeError):
            record.title = "Changed"

    def test_fields(self) -> None:
        now = _now()
        rid = uuid.uuid4()
        record = ConversationRecord(
            id=rid,
            user_id=None,
            title=None,
            orchestrator_mode="planner",
            context_summary=None,
            created_at=now,
            updated_at=now,
        )
        assert record.id == rid
        assert record.title is None
        assert record.orchestrator_mode == "planner"


class TestMessageRecord:
    def test_frozen(self) -> None:
        record = MessageRecord(
            id=uuid.uuid4(),
            conversation_id=uuid.uuid4(),
            role="user",
            content={"text": "hello"},
            iteration=None,
            created_at=_now(),
        )
        with pytest.raises(AttributeError):
            record.role = "assistant"


class TestEventRecord:
    def test_frozen(self) -> None:
        record = EventRecord(
            id=1,
            conversation_id=uuid.uuid4(),
            event_type="task_start",
            data={"key": "value"},
            iteration=1,
            timestamp=_now(),
        )
        with pytest.raises(AttributeError):
            record.event_type = "changed"


class TestAgentRunRecord:
    def test_frozen(self) -> None:
        record = AgentRunRecord(
            id=uuid.uuid4(),
            conversation_id=uuid.uuid4(),
            config={"model": "claude"},
            status="running",
            result=None,
            created_at=_now(),
        )
        with pytest.raises(AttributeError):
            record.status = "completed"
