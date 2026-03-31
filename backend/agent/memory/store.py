"""Persistent memory store backed by PostgreSQL."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.memory.models import MemoryEntry


class PersistentMemoryStore:
    """Async database-backed memory store.

    User-scoped: all entries belong to a user and are accessible across
    all their conversations.  An optional *conversation_id* is stored as
    provenance metadata but is never used for filtering.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        user_id: uuid.UUID | None = None,
        conversation_id: uuid.UUID | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._user_id = user_id
        self._conversation_id = conversation_id

    def _require_user_id(self) -> uuid.UUID:
        """Return the current user id or fail for anonymous sessions."""
        if self._user_id is None:
            raise ValueError("Persistent memory requires an authenticated user")
        return self._user_id

    @property
    def is_available(self) -> bool:
        """Whether this store can use persistent user-scoped storage."""
        return self._user_id is not None

    async def store(self, key: str, value: str, namespace: str = "default") -> None:
        """Store or update a key-value pair scoped to the current user."""
        if not key.strip():
            raise ValueError("Key must not be empty")
        if not value:
            raise ValueError("Value must not be empty")

        user_id = self._require_user_id()

        async with self._session_factory() as session:
            stmt = select(MemoryEntry).where(
                MemoryEntry.namespace == namespace,
                MemoryEntry.key == key,
                MemoryEntry.user_id == user_id,
            )
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing is not None:
                await session.execute(
                    update(MemoryEntry)
                    .where(
                        MemoryEntry.user_id == user_id,
                        MemoryEntry.namespace == namespace,
                        MemoryEntry.key == key,
                    )
                    .values(value=value, conversation_id=self._conversation_id)
                )
            else:
                entry = MemoryEntry(
                    namespace=namespace,
                    key=key,
                    value=value,
                    user_id=user_id,
                    conversation_id=self._conversation_id,
                )
                session.add(entry)

            await session.commit()

    async def recall(
        self, query: str, namespace: str = "default", limit: int = 20
    ) -> list[dict[str, str]]:
        """Search memory entries by substring match on key and value.

        Returns all entries belonging to the current user across all
        conversations.
        """
        if not query.strip():
            return []
        if self._user_id is None:
            return []

        query_lower = f"%{query.lower()}%"
        async with self._session_factory() as session:
            stmt = (
                select(MemoryEntry)
                .where(
                    MemoryEntry.namespace == namespace,
                    MemoryEntry.user_id == self._user_id,
                    or_(
                        func.lower(MemoryEntry.key).like(query_lower),
                        func.lower(MemoryEntry.value).like(query_lower),
                    ),
                )
                .order_by(MemoryEntry.updated_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            entries = result.scalars().all()

            return [
                {
                    "namespace": e.namespace,
                    "key": e.key,
                    "value": e.value,
                    "conversation_id": str(e.conversation_id)
                    if e.conversation_id
                    else None,
                }
                for e in entries
            ]

    async def list_entries(
        self, namespace: str = "default", limit: int = 50
    ) -> list[dict[str, str]]:
        """List all memory entries for the current user in a namespace."""
        if self._user_id is None:
            return []

        async with self._session_factory() as session:
            stmt = (
                select(MemoryEntry)
                .where(
                    MemoryEntry.namespace == namespace,
                    MemoryEntry.user_id == self._user_id,
                )
                .order_by(MemoryEntry.updated_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            entries = result.scalars().all()

            return [
                {
                    "namespace": e.namespace,
                    "key": e.key,
                    "value": e.value,
                    "conversation_id": str(e.conversation_id)
                    if e.conversation_id
                    else None,
                }
                for e in entries
            ]

    async def load_all(self, limit: int = 100) -> list[dict[str, str]]:
        """Load all memory entries for the current user across all namespaces.

        Intended for injecting into the system prompt at conversation start.
        """
        if self._user_id is None:
            return []

        async with self._session_factory() as session:
            stmt = (
                select(MemoryEntry)
                .where(MemoryEntry.user_id == self._user_id)
                .order_by(MemoryEntry.updated_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            entries = result.scalars().all()

            return [
                {
                    "namespace": e.namespace,
                    "key": e.key,
                    "value": e.value,
                }
                for e in entries
            ]
