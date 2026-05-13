"""Memory-backed conversation lifecycle hooks."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.memory.facts import validate_fact_candidate
from agent.memory.compaction_flush import flush_heuristic_facts_from_messages
from agent.memory.heuristic_extract import extract_fact_candidates
from agent.memory.prompt_sections import format_verified_facts_prompt_section
from agent.memory.store import PersistentMemoryStore
from agent.runtime.hooks import (
    ContextCompactionContext,
    ContextCompactionResult,
    ConversationSessionContext,
    ConversationSessionHookResult,
    ConversationTurnContext,
    ConversationTurnStatus,
)
from config.settings import get_settings

MemoryStoreFactory = Callable[
    [async_sessionmaker[AsyncSession], uuid.UUID | None, uuid.UUID | None],
    PersistentMemoryStore,
]
SettingsFactory = Callable[[], Any]

SESSION_VALUE_PERSISTENT_STORE = "persistent_store"
SESSION_VALUE_MEMORY_ENTRIES = "memory_entries"


def default_memory_store_factory(
    session_factory: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID | None,
    conversation_id: uuid.UUID | None,
) -> PersistentMemoryStore:
    """Build the default persistent memory store."""
    return PersistentMemoryStore(
        session_factory=session_factory,
        user_id=user_id,
        conversation_id=conversation_id,
    )


def has_verified_facts_section(runtime_prompt_sections: tuple[str, ...]) -> bool:
    """Return whether a turn prompt already contains verified facts."""
    return any(
        "<verified_user_facts>" in section for section in runtime_prompt_sections
    )


class MemoryConversationHooks:
    """Conversation hooks for persistent memory prefetch and fact updates."""

    def __init__(
        self,
        *,
        memory_store_factory: MemoryStoreFactory = default_memory_store_factory,
        settings_factory: SettingsFactory = get_settings,
    ) -> None:
        self._memory_store_factory = memory_store_factory
        self._settings_factory = settings_factory

    def _store_for(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        user_id: uuid.UUID | None,
        conversation_id: str,
    ) -> PersistentMemoryStore:
        return self._memory_store_factory(
            session_factory,
            user_id,
            uuid.UUID(conversation_id),
        )

    async def before_session_start(
        self,
        context: ConversationSessionContext,
    ) -> ConversationSessionHookResult:
        session_factory = context.metadata.get("db_session_factory")
        if session_factory is None:
            return ConversationSessionHookResult()

        store = self._store_for(
            session_factory,
            user_id=context.user_id,
            conversation_id=context.conversation_id,
        )
        settings = self._settings_factory()
        memory_entries = await store.load_all(
            limit=settings.INITIAL_CONVERSATION_MEMORY_LIMIT,
        )
        return ConversationSessionHookResult(
            {
                SESSION_VALUE_PERSISTENT_STORE: store,
                SESSION_VALUE_MEMORY_ENTRIES: memory_entries,
            }
        )

    async def before_turn(
        self,
        context: ConversationTurnContext,
    ) -> tuple[str, ...]:
        runtime_prompt_sections = context.runtime_prompt_sections
        if (
            not context.message.strip()
            or context.user_id is None
            or has_verified_facts_section(runtime_prompt_sections)
        ):
            return runtime_prompt_sections

        try:
            session_factory = context.metadata.get("db_session_factory")
            if session_factory is None:
                return runtime_prompt_sections
            store = self._store_for(
                session_factory,
                user_id=context.user_id,
                conversation_id=context.conversation_id,
            )
            settings = self._settings_factory()
            facts = await store.retrieve_relevant_facts(
                query=context.message,
                limit=settings.MEMORY_FACT_TOP_K,
            )
            section = format_verified_facts_prompt_section(
                facts,
                token_cap_chars=settings.MEMORY_FACT_PROMPT_TOKEN_CAP,
            )
            if section:
                return (*runtime_prompt_sections, section)
        except Exception:
            logger.opt(exception=True).warning(
                "memory_fact_retrieval_failed conversation_id={}",
                context.conversation_id,
            )

        return runtime_prompt_sections

    async def after_turn(
        self,
        context: ConversationTurnContext,
        status: ConversationTurnStatus,
        result: str,
    ) -> None:
        del result
        if (
            status != "completed"
            or context.user_id is None
            or not context.message.strip()
        ):
            return

        try:
            session_factory = context.metadata.get("db_session_factory")
            if session_factory is None:
                return
            store = self._store_for(
                session_factory,
                user_id=context.user_id,
                conversation_id=context.conversation_id,
            )
            seen = await store.mark_fact_ingestion_seen(
                conversation_id=uuid.UUID(context.conversation_id),
                turn_id=context.turn_id,
            )
            if not seen:
                return

            settings = self._settings_factory()
            candidates = extract_fact_candidates(context.message)
            saved = 0
            rejected = 0
            for candidate in candidates:
                verdict = validate_fact_candidate(
                    candidate,
                    threshold=settings.MEMORY_FACT_CONFIDENCE_THRESHOLD,
                )
                if not verdict.accepted:
                    rejected += 1
                    continue
                await store.upsert_fact(
                    namespace=candidate.namespace,
                    key=candidate.key,
                    value=candidate.value,
                    confidence=candidate.confidence,
                    source=context.source,
                    source_chat_id=str(context.metadata.get("source_chat_id", "")),
                    evidence_snippet=candidate.evidence_snippet,
                )
                saved += 1

            logger.info(
                "memory_fact_extraction_complete conversation_id={} turn_id={} source={} extracted={} saved={} rejected={}",
                context.conversation_id,
                context.turn_id,
                context.source,
                len(candidates),
                saved,
                rejected,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "memory_fact_extraction_failed conversation_id={} turn_id={}",
                context.conversation_id,
                context.turn_id,
            )

    async def before_context_compaction(
        self,
        context: ContextCompactionContext,
    ) -> None:
        if not bool(context.metadata.get("memory_flush")):
            return
        store = context.metadata.get("persistent_store")
        if not isinstance(store, PersistentMemoryStore) or not store.is_available:
            return
        try:
            await flush_heuristic_facts_from_messages(store, context.messages)
        except Exception:
            logger.opt(exception=True).warning(
                "compaction_memory_flush_failed conversation_id={}",
                context.conversation_id,
            )

    async def after_context_compaction(
        self,
        context: ContextCompactionContext,
        result: ContextCompactionResult,
    ) -> None:
        del context, result
