"""Tests for conversation lifecycle memory hooks."""

from __future__ import annotations

import asyncio
import os
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TAVILY_API_KEY", "test-key")

from agent.memory.models import (  # noqa: E402
    MemoryEntry,
    MemoryFactEntry,
    MemoryFactIngestion,
)
from agent.memory.store import PersistentMemoryStore  # noqa: E402
from agent.state.models import UserModel  # noqa: E402
from agent.memory.conversation_hooks import (  # noqa: E402
    MemoryConversationHooks,
    SESSION_VALUE_MEMORY_ENTRIES,
    SESSION_VALUE_PERSISTENT_STORE,
)
from agent.runtime.hooks import (  # noqa: E402
    ContextCompactionContext,
    ConversationSessionContext,
    ConversationTurnContext,
)
from api.events import EventEmitter  # noqa: E402
from api.models import ConversationEntry  # noqa: E402
from api.routes.conversations import _run_turn  # noqa: E402


async def _make_user(session: Any) -> UserModel:
    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        name="Hook User",
    )
    session.add(user)
    await session.flush()
    return user


def _session_factory(session: Any) -> async_sessionmaker:
    return async_sessionmaker(bind=session.bind, expire_on_commit=False)


@pytest.mark.asyncio
async def test_before_session_start_loads_bounded_user_memory(session: Any) -> None:
    user = await _make_user(session)
    for idx in range(3):
        session.add(
            MemoryEntry(
                namespace="default",
                key=f"k{idx}",
                value=f"v{idx}",
                user_id=user.id,
            )
        )
    await session.flush()

    hooks = MemoryConversationHooks()
    resources = await hooks.before_session_start(
        ConversationSessionContext(
            conversation_id=str(uuid.uuid4()),
            user_id=user.id,
            mode="agent",
            compaction_runtime="web_conversation",
            state=SimpleNamespace(),
            metadata={"db_session_factory": _session_factory(session)},
        )
    )

    assert resources.values[SESSION_VALUE_PERSISTENT_STORE].is_available is True
    assert len(resources.values[SESSION_VALUE_MEMORY_ENTRIES]) == 3


@pytest.mark.asyncio
async def test_before_session_start_anonymous_returns_empty_memory(
    session: Any,
) -> None:
    hooks = MemoryConversationHooks()
    resources = await hooks.before_session_start(
        ConversationSessionContext(
            conversation_id=str(uuid.uuid4()),
            user_id=None,
            mode="agent",
            compaction_runtime="web_conversation",
            state=SimpleNamespace(),
            metadata={"db_session_factory": _session_factory(session)},
        )
    )

    assert resources.values[SESSION_VALUE_PERSISTENT_STORE].is_available is False
    assert resources.values[SESSION_VALUE_MEMORY_ENTRIES] == []


@pytest.mark.asyncio
async def test_before_turn_appends_verified_facts_once(session: Any) -> None:
    user = await _make_user(session)
    conversation_id = str(uuid.uuid4())
    session.add(
        MemoryFactEntry(
            user_id=user.id,
            namespace="profile",
            key="profile.timezone",
            value="Asia/Shanghai",
            confidence=0.95,
            status="active",
            source="test",
        )
    )
    await session.flush()

    hooks = MemoryConversationHooks()
    context = ConversationTurnContext(
        conversation_id=conversation_id,
        user_id=user.id,
        turn_id="turn_1",
        message="What is my timezone?",
        source="web",
        runtime_prompt_sections=("route",),
        metadata={"db_session_factory": _session_factory(session)},
    )

    sections = await hooks.before_turn(context)
    assert len(sections) == 2
    assert "<verified_user_facts>" in sections[1]
    assert "Asia/Shanghai" in sections[1]

    duplicated = await hooks.before_turn(
        ConversationTurnContext(
            conversation_id=conversation_id,
            user_id=user.id,
            turn_id="turn_2",
            message="What is my timezone?",
            source="web",
            runtime_prompt_sections=sections,
            metadata={"db_session_factory": _session_factory(session)},
        )
    )
    assert duplicated == sections


@pytest.mark.asyncio
async def test_after_turn_persists_strict_heuristic_facts_once(
    session: Any,
) -> None:
    user = await _make_user(session)
    conversation_id = str(uuid.uuid4())
    hooks = MemoryConversationHooks()
    context = ConversationTurnContext(
        conversation_id=conversation_id,
        user_id=user.id,
        turn_id="provider-message-1",
        message="my timezone is UTC+8",
        source="telegram",
        runtime_prompt_sections=(),
        metadata={
            "db_session_factory": _session_factory(session),
            "source_chat_id": "chat-1",
        },
    )

    await hooks.after_turn(context, "completed", "ok")
    await hooks.after_turn(context, "completed", "ok")

    fact_rows = (
        (
            await session.execute(
                select(MemoryFactEntry).where(MemoryFactEntry.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    ingestion_rows = (
        (await session.execute(select(MemoryFactIngestion))).scalars().all()
    )
    assert len(fact_rows) == 1
    assert fact_rows[0].key == "profile.timezone"
    assert fact_rows[0].value == "UTC+8"
    assert len(ingestion_rows) == 1


@pytest.mark.asyncio
async def test_after_turn_skips_error_status(session: Any) -> None:
    user = await _make_user(session)
    hooks = MemoryConversationHooks()
    await hooks.after_turn(
        ConversationTurnContext(
            conversation_id=str(uuid.uuid4()),
            user_id=user.id,
            turn_id="turn-error",
            message="my timezone is UTC+8",
            source="web",
            runtime_prompt_sections=(),
            metadata={"db_session_factory": _session_factory(session)},
        ),
        "error",
        "Error: failed",
    )

    rows = (await session.execute(select(MemoryFactEntry))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_before_context_compaction_flushes_memory_facts(session: Any) -> None:
    user = await _make_user(session)
    conversation_id = str(uuid.uuid4())
    store = PersistentMemoryStore(
        session_factory=_session_factory(session),
        user_id=user.id,
        conversation_id=uuid.UUID(conversation_id),
    )
    hooks = MemoryConversationHooks()

    await hooks.before_context_compaction(
        ContextCompactionContext(
            conversation_id=conversation_id,
            user_id=user.id,
            messages=({"role": "user", "content": "my timezone is UTC+9"},),
            effective_prompt="prompt",
            profile_name="web_conversation",
            metadata={
                "memory_flush": True,
                "persistent_store": store,
            },
        )
    )

    rows = (
        (
            await session.execute(
                select(MemoryFactEntry).where(MemoryFactEntry.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].key == "profile.timezone"
    assert rows[0].value == "UTC+9"


class _RecordingHooks:
    def __init__(self) -> None:
        self.after_calls = 0

    async def before_session_start(self, context: Any) -> Any:
        raise AssertionError("not used")

    async def before_turn(self, context: ConversationTurnContext) -> tuple[str, ...]:
        return (*context.runtime_prompt_sections, "hook-section")

    async def after_turn(
        self,
        context: ConversationTurnContext,
        status: str,
        result: str,
    ) -> None:
        del context, status, result
        self.after_calls += 1


class _RecordingOrchestrator:
    def __init__(self, result: str) -> None:
        self.result = result
        self.runtime_prompt_sections: tuple[str, ...] = ()

    async def run(self, message: str, **kwargs: Any) -> str:
        del message
        self.runtime_prompt_sections = kwargs["runtime_prompt_sections"]
        return self.result


@pytest.mark.asyncio
async def test_run_turn_uses_hooks_and_schedules_success_after_turn(
    session: Any,
) -> None:
    conversation_id = str(uuid.uuid4())
    hooks = _RecordingHooks()
    orchestrator = _RecordingOrchestrator("done")
    entry = ConversationEntry(
        emitter=EventEmitter(),
        event_queue=asyncio.Queue(),
        orchestrator=orchestrator,
        executor=None,
        pending_callbacks={},
    )
    state = SimpleNamespace(
        conversations={conversation_id: entry},
        db_session_factory=_session_factory(session),
        conversation_hooks=hooks,
    )

    result = await _run_turn(
        state,
        conversation_id,
        orchestrator,
        "hello",
        runtime_prompt_sections=("route",),
        user_id=uuid.uuid4(),
        turn_id="turn-1",
    )
    if entry.background_tasks:
        await asyncio.gather(*entry.background_tasks)

    assert result == "done"
    assert orchestrator.runtime_prompt_sections == ("route", "hook-section")
    assert hooks.after_calls == 1


@pytest.mark.asyncio
async def test_run_turn_does_not_schedule_after_turn_for_error_result(
    session: Any,
) -> None:
    conversation_id = str(uuid.uuid4())
    hooks = _RecordingHooks()
    orchestrator = _RecordingOrchestrator("Error: failed")
    entry = ConversationEntry(
        emitter=EventEmitter(),
        event_queue=asyncio.Queue(),
        orchestrator=orchestrator,
        executor=None,
        pending_callbacks={},
    )
    state = SimpleNamespace(
        conversations={conversation_id: entry},
        db_session_factory=_session_factory(session),
        conversation_hooks=hooks,
    )

    result = await _run_turn(
        state,
        conversation_id,
        orchestrator,
        "hello",
        user_id=uuid.uuid4(),
        turn_id="turn-1",
    )

    assert result == "Error: failed"
    assert hooks.after_calls == 0
