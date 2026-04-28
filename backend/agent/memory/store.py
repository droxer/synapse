"""Persistent memory store backed by PostgreSQL."""

from __future__ import annotations

import uuid
import re
from datetime import datetime, timezone

from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.memory.facts import normalize_fact_key
from agent.memory.models import MemoryEntry
from agent.memory.models import MemoryFactEntry, MemoryFactIngestion
from agent.memory.safety import ensure_memory_text_safe, validate_memory_text

_MEMORY_UPSERT_RETRIES = 3
_FACT_UPSERT_RETRIES = 3
_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_.+-]*")
_STOP_WORDS = {
    "a",
    "about",
    "am",
    "an",
    "are",
    "did",
    "do",
    "for",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "the",
    "to",
    "what",
    "when",
    "where",
    "who",
}
_TERM_ALIASES = {
    "prefer": {"preference", "preferences", "preferred"},
    "preferred": {"prefer", "preference", "preferences"},
    "preference": {"prefer", "preferred", "preferences"},
    "preferences": {"prefer", "preferred", "preference"},
    "tz": {"timezone"},
}


def _is_unique_violation(error: IntegrityError) -> bool:
    """Best-effort cross-database unique-conflict detection."""
    message = str(getattr(error, "orig", error)).lower()
    return "unique" in message or "duplicate" in message


def _query_terms(text: str) -> set[str]:
    terms = {
        term for term in _TOKEN_RE.findall(text.lower()) if term not in _STOP_WORDS
    }
    expanded = set(terms)
    for term in terms:
        expanded.update(_TERM_ALIASES.get(term, ()))
    return expanded


def _memory_score(query_terms: set[str], *, key: str, value: str) -> int:
    if not query_terms:
        return 0
    key_text = key.lower()
    value_text = value.lower()
    score = 0
    for term in query_terms:
        if (
            term == key_text
            or key_text.endswith(f".{term}")
            or key_text.endswith(f"_{term}")
        ):
            score += 8
        elif term in key_text:
            score += 4
        if term in value_text:
            score += 2
    return score


def _memory_match_condition(
    model: type[MemoryEntry] | type[MemoryFactEntry],
    terms: set[str],
):
    conditions = []
    for term in terms:
        like = f"%{term}%"
        conditions.append(func.lower(model.key).like(like))
        conditions.append(func.lower(model.value).like(like))
    return or_(*conditions)


def _is_safe_memory_row(*values: str) -> bool:
    return all(validate_memory_text(value).accepted for value in values if value)


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
        normalized_namespace = ensure_memory_text_safe(
            namespace or "default", field="namespace"
        )
        normalized_key = ensure_memory_text_safe(key, field="key")
        normalized_value = ensure_memory_text_safe(value, field="value")

        user_id = self._require_user_id()

        for attempt in range(_MEMORY_UPSERT_RETRIES):
            async with self._session_factory() as session:
                stmt = (
                    select(MemoryEntry)
                    .where(
                        MemoryEntry.namespace == normalized_namespace,
                        MemoryEntry.key == normalized_key,
                        MemoryEntry.user_id == user_id,
                    )
                    .order_by(
                        MemoryEntry.updated_at.desc(),
                        MemoryEntry.created_at.desc(),
                        MemoryEntry.id.desc(),
                    )
                )
                result = await session.execute(stmt)
                existing = result.scalars().first()

                if existing is not None:
                    await session.execute(
                        update(MemoryEntry)
                        .where(
                            MemoryEntry.user_id == user_id,
                            MemoryEntry.namespace == normalized_namespace,
                            MemoryEntry.key == normalized_key,
                        )
                        .values(
                            value=normalized_value,
                            conversation_id=self._conversation_id,
                        )
                    )
                else:
                    entry = MemoryEntry(
                        namespace=normalized_namespace,
                        key=normalized_key,
                        value=normalized_value,
                        user_id=user_id,
                        conversation_id=self._conversation_id,
                    )
                    session.add(entry)

                try:
                    await session.commit()
                    return
                except IntegrityError as exc:
                    await session.rollback()
                    if attempt < _MEMORY_UPSERT_RETRIES - 1 and _is_unique_violation(
                        exc
                    ):
                        continue
                    raise

        raise RuntimeError("memory entry upsert retries exhausted")

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

        terms = _query_terms(query)
        if not terms:
            return []
        async with self._session_factory() as session:
            stmt = (
                select(MemoryEntry)
                .where(
                    MemoryEntry.namespace == namespace,
                    MemoryEntry.user_id == self._user_id,
                    _memory_match_condition(MemoryEntry, terms),
                )
                .order_by(MemoryEntry.updated_at.desc())
            )
            result = await session.execute(stmt)
            entries = result.scalars().all()

            ranked = []
            for entry in entries:
                if not _is_safe_memory_row(entry.namespace, entry.key, entry.value):
                    continue
                score = _memory_score(terms, key=entry.key, value=entry.value)
                if score <= 0:
                    continue
                ranked.append((score, entry))
            ranked.sort(
                key=lambda item: (
                    item[0],
                    item[1].updated_at or datetime.min.replace(tzinfo=timezone.utc),
                ),
                reverse=True,
            )

            return [
                {
                    "namespace": entry.namespace,
                    "key": entry.key,
                    "value": entry.value,
                    "conversation_id": str(entry.conversation_id)
                    if entry.conversation_id
                    else None,
                    "score": str(score),
                    "source": "memory_entries",
                }
                for score, entry in ranked[:limit]
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
                if _is_safe_memory_row(e.namespace, e.key, e.value)
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
                if _is_safe_memory_row(e.namespace, e.key, e.value)
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

        try:
            normalized_ns = ensure_memory_text_safe(
                namespace.strip().lower(),
                field="namespace",
            )
            normalized_key = ensure_memory_text_safe(
                normalize_fact_key(normalized_ns, key),
                field="key",
            )
            normalized_value = ensure_memory_text_safe(value, field="value")
        except ValueError:
            return None

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
                if _is_safe_memory_row(row.namespace, row.key, row.value)
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

        terms = _query_terms(query or "")
        async with self._session_factory() as session:
            base_conditions = [
                MemoryFactEntry.user_id == self._user_id,
                MemoryFactEntry.status == "active",
            ]
            if terms:
                base_conditions.append(_memory_match_condition(MemoryFactEntry, terms))

            stmt = (
                select(MemoryFactEntry)
                .where(and_(*base_conditions))
                .order_by(
                    desc(MemoryFactEntry.updated_at), desc(MemoryFactEntry.confidence)
                )
            )
            if not terms:
                stmt = stmt.limit(max(limit * 8, 50))
            result = await session.execute(stmt)
            rows = result.scalars().all()
            ranked = []
            for row in rows:
                if not _is_safe_memory_row(row.namespace, row.key, row.value):
                    continue
                score = _memory_score(terms, key=row.key, value=row.value)
                if terms and score <= 0:
                    continue
                ranked.append((score, row))
            ranked.sort(
                key=lambda item: (
                    item[0],
                    item[1].confidence,
                    item[1].updated_at or datetime.min.replace(tzinfo=timezone.utc),
                ),
                reverse=True,
            )
            return [
                {
                    "namespace": row.namespace,
                    "key": row.key,
                    "value": row.value,
                    "confidence": f"{row.confidence:.2f}",
                    "score": str(score),
                    "source": "memory_facts",
                }
                for score, row in ranked[:limit]
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
