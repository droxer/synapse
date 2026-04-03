"""Heuristic memory flush before context compaction (OpenClaw-style)."""

from __future__ import annotations

from typing import Any

from loguru import logger

from agent.memory.facts import validate_fact_candidate
from agent.memory.heuristic_extract import extract_fact_candidates
from agent.memory.store import PersistentMemoryStore
from agent.runtime.observer import _message_plain_text
from config.settings import get_settings


async def flush_heuristic_facts_from_messages(
    store: PersistentMemoryStore,
    messages: tuple[dict[str, Any], ...],
    *,
    source: str = "compaction",
) -> None:
    """Persist high-confidence heuristic facts found in user message text."""
    if not store.is_available:
        return

    settings = get_settings()
    threshold = settings.MEMORY_FACT_CONFIDENCE_THRESHOLD

    for msg in messages:
        if msg.get("role") != "user":
            continue
        text = _message_plain_text(msg)
        if not text:
            continue
        for candidate in extract_fact_candidates(text):
            verdict = validate_fact_candidate(candidate, threshold=threshold)
            if not verdict.accepted:
                continue
            try:
                await store.upsert_fact(
                    namespace=candidate.namespace,
                    key=candidate.key,
                    value=candidate.value,
                    confidence=candidate.confidence,
                    source=source,
                    source_chat_id="",
                    evidence_snippet=candidate.evidence_snippet,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "compaction_memory_flush_upsert_failed key={}",
                    candidate.key,
                )
