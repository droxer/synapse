"""Tests for persistent memory tools (backward compatibility)."""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from agent.memory.compaction_flush import flush_heuristic_facts_from_messages
from agent.memory.facts import FactCandidate, validate_fact_candidate
from agent.memory.models import MemoryEntry, MemoryFactEntry, MemoryFactIngestion
from agent.memory.store import PersistentMemoryStore
from agent.state.models import Base, UserModel
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
        assert result.metadata["persistent"] is False
        assert "current runtime only" in result.output

    async def test_with_none_persistent(self) -> None:
        store: dict[str, str] = {}
        tool = MemoryStore(store=store, persistent_store=None)
        result = await tool.execute(key="k", value="v")
        assert result.success
        assert result.metadata["persistent"] is False

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

    def test_definition_describes_runtime_fallback(self) -> None:
        description = MemoryStore(store={}).definition().description
        assert "persistent user-scoped storage when available" in description
        assert "current runtime" in description


class TestMemoryRecallBackcompat:
    async def test_dict_only(self) -> None:
        store = {"default:hello": "world"}
        tool = MemoryRecall(store=store)
        result = await tool.execute(query="hello")
        assert result.success
        assert result.metadata["persistent"] is False
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
        assert result.metadata["persistent"] is False

    async def test_list_entries(self) -> None:
        store = {"default:a": "1", "default:b": "2", "other:c": "3"}
        tool = MemoryList(store=store)
        result = await tool.execute(namespace="default")
        assert result.success
        assert result.metadata["persistent"] is False
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
        assert "current runtime only" in store_result.output
        assert local_store == {"default:color": "blue"}
        assert json.loads(recall_result.output) == {"default:color": "blue"}
        assert recall_result.metadata["persistent"] is False
        assert json.loads(list_result.output) == {"default:color": "blue"}
        assert list_result.metadata["persistent"] is False


@pytest.mark.asyncio
async def test_load_all_respects_limit(session) -> None:
    user = UserModel(
        id=uuid.uuid4(),
        google_id=f"google_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        name="Memory Limit User",
    )
    session.add(user)
    await session.flush()

    for idx in range(3):
        session.add(
            MemoryEntry(
                namespace="default",
                key=f"k{idx}",
                value=f"v{idx}",
                user_id=user.id,
            )
        )
    await session.commit()

    session_factory = async_sessionmaker(bind=session.bind, expire_on_commit=False)
    store = PersistentMemoryStore(session_factory=session_factory, user_id=user.id)

    entries = await store.load_all(limit=2)

    assert len(entries) == 2


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
async def test_mark_fact_ingestion_seen_is_idempotent_under_concurrency(
    tmp_path,
) -> None:
    db_url = f"sqlite+aiosqlite:///{tmp_path / 'memory_concurrency_ingestion.db'}"
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        bind=engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )

    async with session_factory() as session:
        user = UserModel(
            id=uuid.uuid4(),
            google_id=f"google_{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            name="Fact Ingestion Concurrency User",
        )
        session.add(user)
        await session.commit()
        user_id = user.id

    conversation_id = uuid.uuid4()

    async def _mark_seen() -> bool:
        store = PersistentMemoryStore(session_factory=session_factory, user_id=user_id)
        return await store.mark_fact_ingestion_seen(
            conversation_id=conversation_id,
            turn_id="turn-1",
        )

    results = await asyncio.gather(*[_mark_seen() for _ in range(8)])

    assert results.count(True) == 1
    assert results.count(False) == 7

    async with session_factory() as session:
        ingestions = (
            (await session.execute(select(MemoryFactIngestion))).scalars().all()
        )
        assert len(ingestions) == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_upsert_fact_different_values_keeps_one_active_under_concurrency(
    tmp_path,
) -> None:
    db_url = f"sqlite+aiosqlite:///{tmp_path / 'memory_concurrency_values.db'}"
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        bind=engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )

    async with session_factory() as session:
        user = UserModel(
            id=uuid.uuid4(),
            google_id=f"google_{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            name="Fact Value Concurrency User",
        )
        session.add(user)
        await session.commit()
        user_id = user.id

    async def _write(value: str) -> None:
        store = PersistentMemoryStore(session_factory=session_factory, user_id=user_id)
        await store.upsert_fact(
            namespace="profile",
            key="timezone",
            value=value,
            confidence=0.90,
        )

    await asyncio.gather(_write("UTC+8"), _write("UTC+9"))

    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(MemoryFactEntry).order_by(MemoryFactEntry.value.asc())
                )
            )
            .scalars()
            .all()
        )

    active = [row for row in rows if row.status == "active"]
    stale = [row for row in rows if row.status == "stale"]

    assert len(active) == 1
    assert len(stale) == 1
    assert {row.value for row in rows} == {"UTC+8", "UTC+9"}

    await engine.dispose()


@pytest.mark.asyncio
async def test_upsert_fact_same_value_deduplicates_under_concurrency(
    tmp_path,
) -> None:
    db_url = f"sqlite+aiosqlite:///{tmp_path / 'memory_concurrency_same_value.db'}"
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        bind=engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )

    async with session_factory() as session:
        user = UserModel(
            id=uuid.uuid4(),
            google_id=f"google_{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            name="Fact Same Value Concurrency User",
        )
        session.add(user)
        await session.commit()
        user_id = user.id

    async def _write() -> None:
        store = PersistentMemoryStore(session_factory=session_factory, user_id=user_id)
        await store.upsert_fact(
            namespace="preferences",
            key="language",
            value="English",
            confidence=0.95,
        )

    await asyncio.gather(*[_write() for _ in range(8)])

    async with session_factory() as session:
        rows = (await session.execute(select(MemoryFactEntry))).scalars().all()

    active = [row for row in rows if row.status == "active"]
    stale = [row for row in rows if row.status == "stale"]

    assert len(active) == 1
    assert active[0].value == "English"
    assert stale == []

    await engine.dispose()


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
