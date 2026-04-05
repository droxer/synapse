"""Tests for persistent memory tools (backward compatibility)."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from agent.memory.compaction_flush import flush_heuristic_facts_from_messages
from agent.memory.facts import FactCandidate, validate_fact_candidate
from agent.memory.models import MemoryEntry, MemoryFactEntry
from agent.memory.store import PersistentMemoryStore
from agent.state.models import UserModel
from agent.tools.local.memory_store import MemoryStore
from agent.tools.local.memory_recall import MemoryRecall
from agent.tools.local.memory_list import MemoryList


class TestMemoryStoreBackcompat:
    """Verify backward compatibility with dict-only constructor."""

    async def test_dict_only(self) -> None:
        store: dict[str, str] = {}
        tool = MemoryStore(store=store)
        result = await tool.execute(key="k", value="v")
        assert result.success
        assert store["default:k"] == "v"

    async def test_with_none_persistent(self) -> None:
        store: dict[str, str] = {}
        tool = MemoryStore(store=store, persistent_store=None)
        result = await tool.execute(key="k", value="v")
        assert result.success

    async def test_empty_key_fails(self) -> None:
        tool = MemoryStore(store={})
        result = await tool.execute(key="", value="v")
        assert not result.success

    async def test_empty_value_fails(self) -> None:
        tool = MemoryStore(store={})
        result = await tool.execute(key="k", value="")
        assert not result.success

    async def test_namespace(self) -> None:
        store: dict[str, str] = {}
        tool = MemoryStore(store=store)
        await tool.execute(key="k", value="v", namespace="ns")
        assert "ns:k" in store


class TestMemoryRecallBackcompat:
    async def test_dict_only(self) -> None:
        store = {"default:hello": "world"}
        tool = MemoryRecall(store=store)
        result = await tool.execute(query="hello")
        assert result.success
        data = json.loads(result.output)
        assert "default:hello" in data

    async def test_empty_query_fails(self) -> None:
        tool = MemoryRecall(store={})
        result = await tool.execute(query="")
        assert not result.success

    async def test_no_matches(self) -> None:
        tool = MemoryRecall(store={"default:a": "b"})
        result = await tool.execute(query="xyz")
        assert result.success
        data = json.loads(result.output)
        assert len(data) == 0


class TestMemoryList:
    async def test_empty(self) -> None:
        tool = MemoryList(store={})
        result = await tool.execute()
        assert result.success
        assert result.metadata["count"] == 0

    async def test_list_entries(self) -> None:
        store = {"default:a": "1", "default:b": "2", "other:c": "3"}
        tool = MemoryList(store=store)
        result = await tool.execute(namespace="default")
        assert result.success
        data = json.loads(result.output)
        assert len(data) == 2


class TestPersistentMemoryStoreAnonymousGuard:
    async def test_anonymous_store_does_not_persist(self, session) -> None:
        session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
        store = PersistentMemoryStore(session_factory=session_factory)

        with pytest.raises(ValueError, match="authenticated user"):
            await store.store("color", "blue")

        result = await session.execute(select(MemoryEntry))
        assert result.scalars().all() == []

    async def test_anonymous_recall_and_list_return_empty(self, session) -> None:
        session.add(
            MemoryEntry(
                namespace="default",
                key="color",
                value="blue",
                user_id=None,
            )
        )
        await session.flush()

        session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
        store = PersistentMemoryStore(session_factory=session_factory)

        assert await store.recall("color") == []
        assert await store.list_entries() == []
        assert await store.load_all() == []

    async def test_tools_fall_back_to_in_memory_for_anonymous_store(
        self, session
    ) -> None:
        session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
        persistent = PersistentMemoryStore(session_factory=session_factory)
        local_store: dict[str, str] = {}

        store_tool = MemoryStore(store=local_store, persistent_store=persistent)
        recall_tool = MemoryRecall(store=local_store, persistent_store=persistent)
        list_tool = MemoryList(store=local_store, persistent_store=persistent)

        store_result = await store_tool.execute(key="color", value="blue")
        recall_result = await recall_tool.execute(query="color")
        list_result = await list_tool.execute()

        assert store_result.success
        assert store_result.metadata["persistent"] is False
        assert local_store == {"default:color": "blue"}
        assert json.loads(recall_result.output) == {"default:color": "blue"}
        assert json.loads(list_result.output) == {"default:color": "blue"}


@pytest.mark.asyncio
async def test_memory_fact_row_round_trip(session) -> None:
    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        name="Memory Test User",
    )
    session.add(user)
    await session.flush()

    fact = MemoryFactEntry(
        user_id=user.id,
        namespace="preferences",
        key="preferences.language",
        value="zh-CN",
        confidence=0.93,
        status="active",
        source="telegram",
    )
    session.add(fact)
    await session.flush()

    assert fact.id is not None
    assert fact.status == "active"


def test_validate_fact_rejects_ephemeral_text() -> None:
    candidate = FactCandidate(
        namespace="profile",
        key="profile.mood",
        value="I am tired today",
        confidence=0.91,
    )
    result = validate_fact_candidate(candidate)
    assert result.accepted is False
    assert result.reason == "ephemeral"


def test_validate_fact_rejects_sensitive_key() -> None:
    candidate = FactCandidate(
        namespace="profile",
        key="github_token",
        value="opaque-reference",
        confidence=0.91,
    )
    result = validate_fact_candidate(candidate)
    assert result.accepted is False
    assert result.reason == "sensitive"


@pytest.mark.asyncio
async def test_upsert_fact_marks_previous_active_as_stale(session) -> None:
    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        name="Fact Upsert User",
    )
    session.add(user)
    await session.flush()

    session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
    store = PersistentMemoryStore(session_factory=session_factory, user_id=user.id)

    await store.upsert_fact(
        namespace="profile",
        key="timezone",
        value="UTC+8",
        confidence=0.90,
    )
    await store.upsert_fact(
        namespace="profile",
        key="timezone",
        value="UTC",
        confidence=0.95,
    )

    rows = (await session.execute(select(MemoryFactEntry))).scalars().all()
    active = [row for row in rows if row.status == "active"]
    stale = [row for row in rows if row.status == "stale"]

    assert len(active) == 1
    assert active[0].value == "UTC"
    assert len(stale) == 1
    assert stale[0].value == "UTC+8"


@pytest.mark.asyncio
async def test_upsert_fact_same_value_is_idempotent(session) -> None:
    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        name="Fact Idempotent User",
    )
    session.add(user)
    await session.flush()

    session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
    store = PersistentMemoryStore(session_factory=session_factory, user_id=user.id)

    await store.upsert_fact(
        namespace="preferences",
        key="language",
        value="English",
        confidence=0.90,
    )
    await store.upsert_fact(
        namespace="preferences",
        key="language",
        value="English",
        confidence=0.95,
    )

    rows = (await session.execute(select(MemoryFactEntry))).scalars().all()
    active = [row for row in rows if row.status == "active"]
    stale = [row for row in rows if row.status == "stale"]

    assert len(active) == 1
    assert active[0].value == "English"
    assert active[0].confidence == 0.95
    assert stale == []


@pytest.mark.asyncio
async def test_compaction_flush_ignores_tool_result_messages(
    session, monkeypatch
) -> None:
    monkeypatch.setattr(
        "agent.memory.compaction_flush.get_settings",
        lambda: type("Settings", (), {"MEMORY_FACT_CONFIDENCE_THRESHOLD": 0.85})(),
    )

    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        name="Compaction Flush User",
    )
    session.add(user)
    await session.flush()

    session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
    store = PersistentMemoryStore(session_factory=session_factory, user_id=user.id)

    messages = (
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "call_web_search",
                    "content": "my language is French",
                }
            ],
        },
    )

    await flush_heuristic_facts_from_messages(store, messages)

    rows = (await session.execute(select(MemoryFactEntry))).scalars().all()
    assert rows == []
