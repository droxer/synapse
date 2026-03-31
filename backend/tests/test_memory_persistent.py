"""Tests for persistent memory tools (backward compatibility)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from agent.memory.models import MemoryEntry
from agent.memory.store import PersistentMemoryStore
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
