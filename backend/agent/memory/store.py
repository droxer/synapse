"""Persistent memory store backed by PostgreSQL."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.memory.facts import normalize_fact_key
from agent.memory.models import MemoryEntry
from agent.memory.models import MemoryFactEntry, MemoryFactIngestion

_FACT_UPSERT_RETRIES = 3


def _is_unique_violation(error: IntegrityError) -> bool:
    """Best-effort cross-database unique-conflict detection."""
    message = str(getattr(error, "orig", error)).lower()
    return "unique" in message or "duplicate" in message


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

    async def mark_fact_ingestion_seen(
        self,
        *,
        conversation_id: uuid.UUID,
        turn_id: str,
    ) -> bool:
        """Return False when turn was already processed, True on first-seen."""
        user_id = self._require_user_id()
        async with self._session_factory() as session:
            session.add(
                MemoryFactIngestion(
                    conversation_id=conversation_id,
                    turn_id=turn_id,
                    user_id=user_id,
                )
            )
            try:
                await session.commit()
                return True
            except IntegrityError as exc:
                await session.rollback()
                if _is_unique_violation(exc):
                    return False
                raise

    async def upsert_fact(
        self,
        *,
        namespace: str,
        key: str,
        value: str,
        confidence: float,
        source: str = "telegram",
        source_chat_id: str | None = None,
        evidence_snippet: str | None = None,
    ) -> dict[str, str] | None:
        """Insert a new active fact and mark previous active value stale."""
        user_id = self._require_user_id()
        if not namespace.strip() or not key.strip() or not value.strip():
            return None

        normalized_ns = namespace.strip().lower()
        normalized_key = normalize_fact_key(normalized_ns, key)
        normalized_value = value.strip()

        for attempt in range(_FACT_UPSERT_RETRIES):
            now = datetime.now(timezone.utc)
            async with self._session_factory() as session:
                existing_stmt = (
                    select(MemoryFactEntry)
                    .where(
                        MemoryFactEntry.user_id == user_id,
                        MemoryFactEntry.namespace == normalized_ns,
                        MemoryFactEntry.key == normalized_key,
                        MemoryFactEntry.status == "active",
                    )
                    .order_by(
                        MemoryFactEntry.updated_at.desc(),
                        MemoryFactEntry.created_at.desc(),
                        MemoryFactEntry.id.desc(),
                    )
                )
                existing_result = await session.execute(existing_stmt)
                active = existing_result.scalars().all()
                keeper = next(
                    (row for row in active if row.value == normalized_value),
                    None,
                )

                if keeper is not None:
                    keeper.confidence = confidence
                    keeper.source = source
                    keeper.source_chat_id = source_chat_id
                    keeper.evidence_snippet = evidence_snippet
                    keeper.last_seen_at = now
                    keeper.updated_at = now
                    for row in active:
                        if row.id != keeper.id:
                            row.status = "stale"
                            row.updated_at = now
                else:
                    for row in active:
                        row.status = "stale"
                        row.updated_at = now

                    session.add(
                        MemoryFactEntry(
                            user_id=user_id,
                            namespace=normalized_ns,
                            key=normalized_key,
                            value=normalized_value,
                            confidence=confidence,
                            status="active",
                            source=source,
                            source_chat_id=source_chat_id,
                            evidence_snippet=evidence_snippet,
                            last_seen_at=now,
                        )
                    )

                try:
                    await session.commit()
                    return {
                        "namespace": normalized_ns,
                        "key": normalized_key,
                        "value": normalized_value,
                        "confidence": str(confidence),
                        "status": "active",
                    }
                except IntegrityError as exc:
                    await session.rollback()
                    if attempt < _FACT_UPSERT_RETRIES - 1 and _is_unique_violation(exc):
                        continue
                    raise

        raise RuntimeError("memory fact upsert retries exhausted")

    async def list_active_facts(self, limit: int = 50) -> list[dict[str, str]]:
        """Return active facts for the current user."""
        if self._user_id is None:
            return []

        async with self._session_factory() as session:
            stmt = (
                select(MemoryFactEntry)
                .where(
                    MemoryFactEntry.user_id == self._user_id,
                    MemoryFactEntry.status == "active",
                )
                .order_by(desc(MemoryFactEntry.updated_at))
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [
                {
                    "namespace": row.namespace,
                    "key": row.key,
                    "value": row.value,
                    "confidence": f"{row.confidence:.2f}",
                }
                for row in rows
            ]

    async def retrieve_relevant_facts(
        self,
        *,
        query: str,
        limit: int = 8,
    ) -> list[dict[str, str]]:
        """Retrieve active facts ranked by simple lexical relevance and recency."""
        if self._user_id is None:
            return []

        query_text = (query or "").strip().lower()
        async with self._session_factory() as session:
            base_conditions = [
                MemoryFactEntry.user_id == self._user_id,
                MemoryFactEntry.status == "active",
            ]
            if query_text:
                like = f"%{query_text}%"
                base_conditions.append(
                    or_(
                        func.lower(MemoryFactEntry.key).like(like),
                        func.lower(MemoryFactEntry.value).like(like),
                    )
                )

            stmt = (
                select(MemoryFactEntry)
                .where(and_(*base_conditions))
                .order_by(
                    desc(MemoryFactEntry.updated_at), desc(MemoryFactEntry.confidence)
                )
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [
                {
                    "namespace": row.namespace,
                    "key": row.key,
                    "value": row.value,
                    "confidence": f"{row.confidence:.2f}",
                }
                for row in rows
            ]

    async def forget_fact(self, key: str) -> bool:
        """Mark a single active fact stale by canonical key."""
        if self._user_id is None:
            return False
        normalized = key.strip().lower()
        if not normalized:
            return False

        async with self._session_factory() as session:
            stmt = (
                update(MemoryFactEntry)
                .where(
                    MemoryFactEntry.user_id == self._user_id,
                    MemoryFactEntry.key == normalized,
                    MemoryFactEntry.status == "active",
                )
                .values(status="stale", updated_at=datetime.now(timezone.utc))
            )
            result = await session.execute(stmt)
            await session.commit()
            return bool(result.rowcount)

    async def forget_all_facts(self) -> int:
        """Mark all active facts stale for the current user."""
        if self._user_id is None:
            return 0

        async with self._session_factory() as session:
            stmt = (
                update(MemoryFactEntry)
                .where(
                    MemoryFactEntry.user_id == self._user_id,
                    MemoryFactEntry.status == "active",
                )
                .values(status="stale", updated_at=datetime.now(timezone.utc))
            )
            result = await session.execute(stmt)
            await session.commit()
            return int(result.rowcount or 0)
