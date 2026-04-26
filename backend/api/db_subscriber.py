"""Database event subscriber for persisting agent events to PostgreSQL.

Registered on the EventEmitter for each conversation. Persists events,
messages, and status updates without coupling the orchestrator to the
database. Transient failures are retried with exponential backoff;
permanent failures are logged at error level and never propagate.
"""

from __future__ import annotations

import asyncio
import dataclasses
import uuid
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy.exc import (
    IntegrityError,
    OperationalError,
    InterfaceError,
    ProgrammingError,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.state.repository import (
    ConversationRepository,
    SkillRepository,
    UserPromptRepository,
    UsageRepository,
)
from agent.context.profiles import resolve_compaction_profile_by_name
from api.events import AgentEvent, EventType, SubscriberCallback
from config.settings import get_settings

# Event types that should not be persisted (too noisy or ephemeral)
_SKIP_EVENTS = {EventType.TEXT_DELTA}

# Retry configuration
_MAX_RETRIES = 5
_BASE_DELAY = 0.15  # seconds — delays: 0.15, 0.45, 1.35, 4.05

# Exceptions worth retrying (transient / connection issues)
_RETRYABLE_EXCEPTIONS = (OperationalError, InterfaceError, TimeoutError, OSError)

# Per-conversation background persistence queue bounds retained event payloads.
_PERSISTENCE_QUEUE_MAXSIZE = 1000
_PERSISTENCE_WORKER_IDLE_TIMEOUT_SECONDS = 30.0


def _normalize_artifact_payload(
    clean: dict[str, Any],
) -> dict[str, Any] | None:
    """Return a validated artifact payload or ``None`` when malformed."""
    artifact_id = str(clean.get("artifact_id", "")).strip()
    storage_key = str(clean.get("storage_key", artifact_id)).strip()
    name = str(clean.get("name", "")).strip()
    content_type = str(clean.get("content_type", "")).strip()
    size = clean.get("size")

    if not artifact_id or not storage_key or not name or not content_type:
        return None

    try:
        size_int = int(size)
    except (TypeError, ValueError):
        return None

    if size_int < 0:
        return None

    file_path = clean.get("file_path")
    if not isinstance(file_path, str) or not file_path.strip():
        file_path = None

    return {
        "artifact_id": artifact_id,
        "storage_key": storage_key,
        "name": name,
        "content_type": content_type,
        "size": size_int,
        "file_path": file_path,
    }


class PendingWrites:
    """Tracks in-flight DB writes so shutdown can wait for them to drain."""

    def __init__(self) -> None:
        self._count = 0
        self._drained = asyncio.Event()
        self._drained.set()  # starts drained (no pending writes)

    @property
    def count(self) -> int:
        return self._count

    def _increment(self) -> None:
        self._count += 1
        self._drained.clear()

    def _decrement(self) -> None:
        self._count = max(0, self._count - 1)
        if self._count == 0:
            self._drained.set()

    class _Tracker:
        def __init__(self, pending: PendingWrites) -> None:
            self._pending = pending

        async def __aenter__(self) -> None:
            self._pending._increment()

        async def __aexit__(self, *_: Any) -> None:
            self._pending._decrement()

    def track(self) -> _Tracker:
        return self._Tracker(self)

    async def wait_drained(self, timeout: float = 5.0) -> bool:
        """Wait until all pending writes complete. Returns False on timeout."""
        try:
            await asyncio.wait_for(self._drained.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            logger.warning(
                "pending_writes_drain_timeout remaining={} timeout={:.1f}",
                self._count,
                timeout,
            )
            return False


def _make_serializable(value: Any) -> Any:
    """Recursively convert non-JSON-serializable objects to plain types."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return dataclasses.asdict(value)
    if isinstance(value, dict):
        return {k: _make_serializable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_make_serializable(item) for item in value]
    return value


def _clean_data(data: dict[str, Any]) -> dict[str, Any]:
    """Remove non-serializable entries (e.g. callbacks) and convert
    dataclass values to plain dicts for JSONB storage."""
    cleaned = {
        k: v for k, v in data.items() if not callable(v) and k != "response_callback"
    }
    return _make_serializable(cleaned)


async def _retry_with_backoff(
    func: Callable[[], Coroutine[Any, Any, None]],
    conversation_id: uuid.UUID,
    event: AgentEvent,
    clean_data: dict[str, Any],
) -> None:
    """Execute ``func`` with exponential backoff on transient errors."""
    last_exc: BaseException | None = None

    for attempt in range(_MAX_RETRIES):
        try:
            await func()
            return
        except _RETRYABLE_EXCEPTIONS as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES - 1:
                delay = _BASE_DELAY * (3**attempt)
                logger.warning(
                    "db_subscriber_retry attempt={}/{} delay={:.2f}s "
                    "conversation_id={} event_type={} error={}",
                    attempt + 1,
                    _MAX_RETRIES,
                    delay,
                    conversation_id,
                    event.type.value,
                    exc,
                )
                await asyncio.sleep(delay)
        except IntegrityError as exc:
            exc_str = str(exc)
            if "ForeignKeyViolationError" in exc_str and attempt < _MAX_RETRIES - 1:
                # FK violation may be a timing issue — conversation row
                # not yet visible to this session.  Retry with backoff.
                last_exc = exc
                delay = _BASE_DELAY * (3**attempt)
                logger.warning(
                    "db_subscriber_fk_retry attempt={}/{} delay={:.2f}s "
                    "conversation_id={} event_type={}",
                    attempt + 1,
                    _MAX_RETRIES,
                    delay,
                    conversation_id,
                    event.type.value,
                )
                await asyncio.sleep(delay)
            else:
                # Other integrity errors are non-retryable
                logger.error(
                    "db_subscriber_event_lost_non_retryable "
                    "conversation_id={} event_type={} error={} data={}",
                    conversation_id,
                    event.type.value,
                    exc,
                    clean_data,
                )
                return
        except ProgrammingError as exc:
            # Non-retryable SQL errors
            logger.error(
                "db_subscriber_event_lost_non_retryable "
                "conversation_id={} event_type={} error={} data={}",
                conversation_id,
                event.type.value,
                exc,
                clean_data,
            )
            return

    # All retries exhausted
    logger.error(
        "db_subscriber_event_lost conversation_id={} event_type={} error={} data={}",
        conversation_id,
        event.type.value,
        last_exc,
        clean_data,
    )


def create_db_subscriber(
    conversation_id: uuid.UUID,
    repo: ConversationRepository,
    session_factory: async_sessionmaker[AsyncSession],
    pending_writes: PendingWrites | None = None,
    skill_repo: SkillRepository | None = None,
    prompt_repo: UserPromptRepository | None = None,
    user_id: uuid.UUID | None = None,
    usage_repo: UsageRepository | None = None,
) -> SubscriberCallback:
    """Create an async event subscriber that persists to PostgreSQL."""

    logger.info("db_subscriber_created conversation_id={}", conversation_id)
    persistence_queue: asyncio.Queue[AgentEvent] = asyncio.Queue(
        maxsize=_PERSISTENCE_QUEUE_MAXSIZE
    )
    worker_task: asyncio.Task[None] | None = None

    async def _persist_event(event: AgentEvent) -> None:
        if event.type in _SKIP_EVENTS:
            return

        clean = _clean_data(event.data)
        persisted_timestamp = datetime.fromtimestamp(event.timestamp, tz=timezone.utc)

        async def _do_write() -> None:
            async with session_factory() as session:

                async def _save_event_record() -> None:
                    await repo.save_event(
                        session,
                        conversation_id,
                        event_type=event.type.value,
                        data=clean,
                        iteration=event.iteration,
                        timestamp=persisted_timestamp,
                    )

                if event.type == EventType.TURN_START:
                    message = clean.get("message", "")
                    attachments = clean.get("attachments")
                    content: dict[str, Any] = {"text": message}
                    if isinstance(attachments, list) and attachments:
                        content["attachments"] = attachments
                    await repo.save_message(
                        session,
                        conversation_id,
                        role="user",
                        content=content,
                        iteration=None,
                    )
                    await _save_event_record()
                    logger.info(
                        "db_message_saved role=user conversation_id={}",
                        conversation_id,
                    )

                elif event.type == EventType.TURN_COMPLETE:
                    result = clean.get("result", "")
                    await repo.save_message(
                        session,
                        conversation_id,
                        role="assistant",
                        content={"text": result},
                        iteration=event.iteration,
                    )
                    await _save_event_record()
                    logger.info(
                        "db_message_saved role=assistant conversation_id={}",
                        conversation_id,
                    )

                elif event.type == EventType.TASK_COMPLETE:
                    await _save_event_record()
                    logger.info(
                        "db_message_skipped role=assistant (task_complete) "
                        "conversation_id={}",
                        conversation_id,
                    )

                elif event.type == EventType.TASK_ERROR:
                    await _save_event_record()

                elif event.type == EventType.MESSAGE_USER:
                    # Event-only assistant notification. Keep it out of the
                    # canonical messages table, but persist the event so
                    # historical replay can recover planner-visible replies
                    # that were emitted via the user_message tool.
                    await _save_event_record()
                    logger.info(
                        "db_message_skipped role=assistant (message_user) "
                        "conversation_id={}",
                        conversation_id,
                    )

                elif event.type == EventType.ASK_USER:
                    await _save_event_record()

                elif event.type == EventType.USER_RESPONSE:
                    reply = clean.get("response", "")
                    already_persisted = bool(clean.get("persisted"))
                    if reply and not already_persisted:
                        await repo.save_message(
                            session,
                            conversation_id,
                            role="user",
                            content={"text": reply},
                            iteration=event.iteration,
                        )
                        logger.info(
                            "db_message_saved role=user (user_response) "
                            "conversation_id={}",
                            conversation_id,
                        )
                    if not already_persisted:
                        await _save_event_record()

                elif event.type == EventType.ARTIFACT_CREATED:
                    artifact_payload = _normalize_artifact_payload(clean)
                    if artifact_payload is None:
                        logger.warning(
                            "db_subscriber_invalid_artifact_event "
                            "conversation_id={} data={}",
                            conversation_id,
                            clean,
                        )
                    else:
                        await repo.save_artifact(
                            session,
                            artifact_id=artifact_payload["artifact_id"],
                            conversation_id=conversation_id,
                            storage_key=artifact_payload["storage_key"],
                            original_name=artifact_payload["name"],
                            content_type=artifact_payload["content_type"],
                            size=artifact_payload["size"],
                            file_path=artifact_payload["file_path"],
                        )
                    # Also persist as a regular event so historical views
                    # can reconstruct the artifact list from the events table.
                    await _save_event_record()

                elif event.type == EventType.SKILL_ACTIVATED:
                    await _save_event_record()
                    skill_name = clean.get("name", "")
                    if skill_name and skill_repo is not None:
                        await skill_repo.record_activation(
                            session, skill_name, user_id=user_id
                        )
                        logger.debug(
                            "skill_activation_recorded name={} conversation_id={}",
                            skill_name,
                            conversation_id,
                        )

                elif event.type == EventType.LLM_RESPONSE:
                    await _save_event_record()
                    if usage_repo is not None:
                        usage = clean.get("usage", {})
                        input_tok = usage.get("input_tokens", 0)
                        output_tok = usage.get("output_tokens", 0)
                        if input_tok or output_tok:
                            await usage_repo.increment(
                                session,
                                conversation_id,
                                user_id,
                                input_tokens=input_tok,
                                output_tokens=output_tok,
                            )

                elif event.type == EventType.CONVERSATION_TITLE:
                    title = clean.get("title", "")
                    if title:
                        await repo.update_conversation(
                            session, conversation_id, title=title
                        )

                elif event.type == EventType.CONTEXT_COMPACTED:
                    summary = clean.get("summary_text")
                    summary_scope = clean.get("summary_scope")
                    should_merge_summary = summary_scope != "task_agent"
                    if (
                        should_merge_summary
                        and isinstance(summary, str)
                        and summary.strip()
                    ):
                        settings = get_settings()
                        compaction_profile = resolve_compaction_profile_by_name(
                            settings,
                            clean.get("compaction_profile"),
                        )
                        await repo.merge_conversation_context_summary(
                            session,
                            conversation_id,
                            summary.strip(),
                            compaction_profile.context_summary_max_chars,
                        )
                    await _save_event_record()

                else:
                    await _save_event_record()

        async def _persist() -> None:
            try:
                await _retry_with_backoff(_do_write, conversation_id, event, clean)
            except Exception:
                logger.error(
                    "db_subscriber_event_lost_unexpected "
                    "conversation_id={} event_type={} data={}",
                    conversation_id,
                    event.type.value,
                    clean,
                    exc_info=True,
                )

        await _persist()

    async def _worker() -> None:
        while True:
            try:
                event = await asyncio.wait_for(
                    persistence_queue.get(),
                    timeout=_PERSISTENCE_WORKER_IDLE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                return

            try:
                await _persist_event(event)
            finally:
                persistence_queue.task_done()
                if pending_writes is not None:
                    pending_writes._decrement()  # noqa: SLF001

    def _ensure_worker() -> None:
        nonlocal worker_task
        if worker_task is None or worker_task.done():
            worker_task = asyncio.create_task(
                _worker(),
                name=f"db-subscriber-{str(conversation_id)[:8]}",
            )

    async def _subscriber(event: AgentEvent) -> None:
        if event.type in _SKIP_EVENTS:
            return

        if pending_writes is None:
            await _persist_event(event)
            return

        pending_writes._increment()  # noqa: SLF001
        try:
            _ensure_worker()
            if persistence_queue.full():
                logger.warning(
                    "db_subscriber_queue_full conversation_id={} maxsize={}",
                    conversation_id,
                    _PERSISTENCE_QUEUE_MAXSIZE,
                )
            snapshot = AgentEvent(
                type=event.type,
                data=_clean_data(event.data),
                timestamp=event.timestamp,
                iteration=event.iteration,
            )
            await persistence_queue.put(snapshot)
        except BaseException:
            pending_writes._decrement()  # noqa: SLF001
            raise

    return _subscriber
