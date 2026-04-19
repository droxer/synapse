from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.db_subscriber import create_db_subscriber
from api.events import EventEmitter, EventType
from agent.state.models import Base
from agent.state.models import UserPromptModel
from agent.state.repository import ConversationRepository, UserPromptRepository
from api.user_responses import UserResponseCoordinator


@pytest.mark.asyncio
async def test_cross_instance_response_can_be_polled_from_storage() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    conversation_repo = ConversationRepository()
    prompt_repo = UserPromptRepository()
    coordinator = UserResponseCoordinator(
        session_factory=session_factory,
        prompt_repo=prompt_repo,
        conversation_repo=conversation_repo,
    )

    conversation_id = uuid.uuid4()
    async with session_factory() as session:
        await conversation_repo.create_conversation(
            session,
            conversation_id=conversation_id,
            title="test",
        )

    request_id = "req_test123"
    await coordinator.register_prompt(
        conversation_id=str(conversation_id),
        request_id=request_id,
        question="Need approval?",
    )
    future = coordinator.register_local_waiter(
        conversation_id=str(conversation_id),
        request_id=request_id,
    )

    async def _submit() -> None:
        await asyncio.sleep(0.05)
        accepted = await coordinator.submit_response(
            conversation_id=str(conversation_id),
            request_id=request_id,
            response="yes",
        )
        assert accepted is True

    submit_task = asyncio.create_task(_submit())
    response = await coordinator.wait_for_response(
        conversation_id=str(conversation_id),
        request_id=request_id,
        future=future,
        timeout=1.0,
    )
    await submit_task

    assert response == "yes"

    async with session_factory() as session:
        prompt = await prompt_repo.get_prompt(session, request_id=request_id)
        messages = await conversation_repo.get_messages(session, conversation_id)

    assert prompt is not None
    assert prompt.status == "responded"
    assert prompt.response == "yes"
    assert messages[-1].content == {"text": "yes"}

    await engine.dispose()


@pytest.mark.asyncio
async def test_emit_and_wait_creates_single_prompt_row() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    conversation_repo = ConversationRepository()
    prompt_repo = UserPromptRepository()
    coordinator = UserResponseCoordinator(
        session_factory=session_factory,
        prompt_repo=prompt_repo,
        conversation_repo=conversation_repo,
    )

    conversation_id = uuid.uuid4()
    async with session_factory() as session:
        await conversation_repo.create_conversation(
            session,
            conversation_id=conversation_id,
            title="test",
        )

    emitter = EventEmitter(
        conversation_id=str(conversation_id),
        response_coordinator=coordinator,
    )
    emitter.subscribe(
        create_db_subscriber(
            conversation_id,
            conversation_repo,
            session_factory,
            prompt_repo=prompt_repo,
        )
    )

    request_id_holder: dict[str, str] = {}

    async def _auto_reply(event) -> None:
        if event.type != EventType.ASK_USER:
            return
        request_id_holder["request_id"] = str(event.data["request_id"])
        callback = event.data["response_callback"]
        callback("yes")

    emitter.subscribe(_auto_reply)

    response = await emitter.emit_and_wait(
        EventType.ASK_USER,
        {"question": "Need approval?"},
        timeout=1.0,
    )

    async with session_factory() as session:
        prompt = await prompt_repo.get_prompt(
            session, request_id=request_id_holder["request_id"]
        )
        count = await session.scalar(select(func.count()).select_from(UserPromptModel))

    assert response == "yes"
    assert prompt is not None
    assert count == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_emit_and_wait_persists_structured_prompt_fields() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    conversation_repo = ConversationRepository()
    prompt_repo = UserPromptRepository()
    coordinator = UserResponseCoordinator(
        session_factory=session_factory,
        prompt_repo=prompt_repo,
        conversation_repo=conversation_repo,
    )

    conversation_id = uuid.uuid4()
    async with session_factory() as session:
        await conversation_repo.create_conversation(
            session,
            conversation_id=conversation_id,
            title="test",
        )

    emitter = EventEmitter(
        conversation_id=str(conversation_id),
        response_coordinator=coordinator,
    )
    emitter.subscribe(
        create_db_subscriber(
            conversation_id,
            conversation_repo,
            session_factory,
            prompt_repo=prompt_repo,
        )
    )

    request_id_holder: dict[str, str] = {}

    async def _auto_reply(event) -> None:
        if event.type != EventType.ASK_USER:
            return
        request_id_holder["request_id"] = str(event.data["request_id"])
        callback = event.data["response_callback"]
        callback("approve")

    emitter.subscribe(_auto_reply)

    response = await emitter.emit_and_wait(
        EventType.ASK_USER,
        {
            "question": "Deploy the draft build?",
            "title": "Approval required",
            "prompt_kind": "approval",
            "options": [
                {"id": "approve", "label": "Approve", "value": "approve"},
                {"id": "deny", "label": "Deny", "value": "deny"},
            ],
            "prompt_metadata": {
                "allow_freeform": False,
                "risk": "This replaces the visible preview.",
            },
        },
        timeout=1.0,
    )

    async with session_factory() as session:
        prompt = await prompt_repo.get_prompt(
            session, request_id=request_id_holder["request_id"]
        )

    assert response == "approve"
    assert prompt is not None
    assert prompt.prompt_kind == "approval"
    assert prompt.title == "Approval required"
    assert prompt.options == (
        {"id": "approve", "label": "Approve", "value": "approve"},
        {"id": "deny", "label": "Deny", "value": "deny"},
    )
    assert prompt.prompt_metadata == {
        "allow_freeform": False,
        "risk": "This replaces the visible preview.",
    }

    await engine.dispose()
