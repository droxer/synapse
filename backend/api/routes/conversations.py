"""Conversation route handlers."""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import StreamingResponse
from loguru import logger
from starlette.datastructures import UploadFile
from starlette.requests import Request

from agent.llm.client import ClaudeClient
from agent.memory.store import PersistentMemoryStore
from api.dependencies import AppState, get_app_state, get_db_session
from api.models import (
    ConversationEntry,
    ConversationResponse,
    FileAttachment,
    MAX_FILE_SIZE_MB,
    MAX_FILES_PER_MESSAGE,
    MessageRequest,
    UserInputRequest,
)
from api.auth import common_dependencies
from api.builders import _build_orchestrator, _build_planner_orchestrator
from api.sse import _create_queue_subscriber, _event_generator
from api.events import AgentEvent, EventEmitter, EventType
from api.db_subscriber import create_db_subscriber
from config.settings import get_settings

# UUID pattern for path parameter validation
_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Max event queue size for backpressure
_EVENT_QUEUE_MAXSIZE = 5000

router = APIRouter(dependencies=common_dependencies)


# ---------------------------------------------------------------------------
# File upload helpers
# ---------------------------------------------------------------------------


def _sanitize_filename(name: str) -> str:
    """Strip path components and dangerous characters from a filename.

    Prevents path-traversal attacks (e.g. ``../../etc/passwd``) by extracting
    only the basename and replacing non-word characters (except ``.-`` and
    space) with underscores.
    """
    name = os.path.basename(name)
    name = re.sub(r"[^\w.\- ]", "_", name)
    return name.strip() or "unnamed"


async def _parse_uploads(files: list[UploadFile]) -> tuple[FileAttachment, ...]:
    """Validate and convert uploaded files into immutable FileAttachment tuples."""
    if len(files) > MAX_FILES_PER_MESSAGE:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files (max {MAX_FILES_PER_MESSAGE})",
        )

    attachments: list[FileAttachment] = []
    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    for f in files:
        data = await f.read()
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' exceeds {MAX_FILE_SIZE_MB}MB limit",
            )
        safe_name = _sanitize_filename(f.filename or "unnamed")
        attachments.append(
            FileAttachment(
                filename=safe_name,
                content_type=f.content_type or "application/octet-stream",
                data=data,
                size=len(data),
            )
        )
    return tuple(attachments)


def _extract_upload_files(raw_files: list[Any]) -> list[UploadFile]:
    """Return only upload-file parts from a multipart form payload."""
    return [f for f in raw_files if isinstance(f, UploadFile)]


def _extract_selected_skills(form: Any) -> tuple[str, ...]:
    """Extract selected skill names from a multipart form payload."""
    raw_values = form.getlist("skills")
    if not raw_values:
        single = form.get("skills")
        if single is not None:
            raw_values = [single]

    skills: list[str] = []
    for value in raw_values:
        skill = str(value).strip()
        if skill:
            skills.append(skill)
    return tuple(skills)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


async def _reconstruct_conversation(
    state: AppState,
    conversation_id: str,
) -> ConversationEntry | None:
    """Reconstruct a conversation from DB history when it's been evicted from memory.

    Returns the new ConversationEntry, or None if the conversation doesn't exist in DB.
    """
    conv_uuid = uuid.UUID(conversation_id)
    async with state.db_session_factory() as session:
        convo = await state.db_repo.get_conversation(session, conv_uuid)
        if convo is None:
            return None
        db_messages = await state.db_repo.get_messages(session, conv_uuid)

    # Convert DB messages to Claude API format
    initial_messages: list[dict[str, Any]] = []
    for m in db_messages:
        if m.role not in ("user", "assistant"):
            continue
        content = m.content
        if isinstance(content, list):
            # Preserve multimodal content as-is
            initial_messages.append({"role": m.role, "content": content})
        elif isinstance(content, dict) and "text" in content:
            text = content["text"]
            initial_messages.append({"role": m.role, "content": text})
        elif isinstance(content, str):
            initial_messages.append({"role": m.role, "content": content})
        else:
            initial_messages.append({"role": m.role, "content": str(content)})

    emitter = EventEmitter()
    event_queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue(
        maxsize=_EVENT_QUEUE_MAXSIZE,
    )
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(event_queue, pending_callbacks)
    emitter.subscribe(subscriber)

    persistent_store = PersistentMemoryStore(
        session_factory=state.db_session_factory,
        conversation_id=conv_uuid,
    )

    orchestrator, executor = _build_orchestrator(
        state.claude_client,
        emitter,
        state.sandbox_provider,
        state.storage_backend,
        initial_messages=tuple(initial_messages),
        persistent_store=persistent_store,
        mcp_state=state.mcp_state,
        skill_registry=getattr(state, "skill_registry", None),
    )

    entry = ConversationEntry(
        emitter=emitter,
        event_queue=event_queue,
        orchestrator=orchestrator,
        executor=executor,
        pending_callbacks=pending_callbacks,
    )
    entry.subscriber = subscriber
    state.conversations[conversation_id] = entry

    # Re-register DB subscriber for new events
    db_sub = create_db_subscriber(
        conv_uuid, state.db_repo, state.db_session_factory, state.db_pending_writes
    )
    emitter.subscribe(db_sub)

    logger.info(
        "conversation_reconstructed id=%s messages=%d",
        conversation_id,
        len(initial_messages),
    )
    return entry


async def _run_turn(
    state: AppState,
    conversation_id: str,
    orchestrator: Any,
    message: str,
    attachments: tuple[FileAttachment, ...] = (),
    selected_skills: tuple[str, ...] = (),
) -> str:
    """Run a single turn of the conversation. Does NOT close the SSE connection."""
    try:
        # Store attachments on the entry so retry can re-send them
        entry = state.conversations.get(conversation_id)
        if entry is not None and attachments:
            entry.last_attachments = attachments
        if entry is not None:
            entry.last_selected_skills = selected_skills
        # NOTE: file upload to sandbox is now handled inside
        # orchestrator.run() — after skill matching — so that files
        # land in the correct sandbox template (e.g. data_science).

        logger.info("turn_started conversation_id=%s", conversation_id)
        result = await orchestrator.run(
            message,
            attachments=attachments,
            selected_skills=selected_skills,
        )
        logger.info("turn_completed conversation_id=%s", conversation_id)
        return result
    except asyncio.CancelledError:
        logger.info("turn_cancelled conversation_id=%s", conversation_id)
        entry = state.conversations.get(conversation_id)
        if entry is not None:
            await entry.emitter.emit(
                EventType.TURN_CANCELLED,
                {"result": "Turn was cancelled."},
            )
        return "Cancelled."
    except Exception:
        logger.exception("turn_failed conversation_id=%s", conversation_id)
        # Emit error event so the frontend is notified (C4 fix)
        entry = state.conversations.get(conversation_id)
        if entry is not None:
            await entry.emitter.emit(
                EventType.TASK_ERROR,
                {"error": "An internal error occurred. Please try again."},
            )
        return "Error: An internal error occurred."


async def _cleanup_conversation(
    state: AppState,
    conversation_id: str,
) -> None:
    """Clean up conversation resources when SSE connection closes."""
    entry = state.conversations.pop(conversation_id, None)
    if entry is None:
        return

    if entry.subscriber is not None:
        entry.emitter.unsubscribe(entry.subscriber)

    # Cancel any running turn
    if entry.turn_task is not None and not entry.turn_task.done():
        entry.turn_task.cancel()

    # Cleanup executor (sandbox, etc.)
    try:
        await entry.executor.cleanup()
    except Exception as exc:
        logger.error(
            "cleanup_failed conversation_id=%s error=%s", conversation_id, str(exc)
        )

    # Drain remaining events
    while not entry.event_queue.empty():
        try:
            entry.event_queue.get_nowait()
        except asyncio.QueueEmpty:
            break

    logger.info("conversation_cleaned_up conversation_id=%s", conversation_id)


async def _cleanup_stale_conversations(state: AppState) -> None:
    """Periodically remove conversations that have been idle too long (H2 fix)."""
    import time as _time

    # Stale conversation TTL in seconds (1 hour)
    conversation_ttl_seconds = 3600

    while True:
        await asyncio.sleep(300)  # Check every 5 minutes
        now = _time.monotonic()
        stale_ids: list[str] = []
        for cid, entry in state.conversations.items():
            age = now - entry.created_at
            if age > conversation_ttl_seconds:
                # Only clean up if the turn is done and queue is drained
                if entry.turn_task is None or entry.turn_task.done():
                    stale_ids.append(cid)
        for cid in stale_ids:
            logger.info("cleaning_stale_conversation id=%s", cid)
            await _cleanup_conversation(state, cid)


async def _generate_title(
    claude_client: ClaudeClient,
    conversation_id: str,
    user_message: str,
    emitter: EventEmitter,
) -> None:
    """Generate a short conversation title using the lite model."""
    try:
        settings = get_settings()
        response = await claude_client.create_message(
            system=(
                "Generate a concise title (max 50 chars) for this conversation. "
                "Reply with ONLY the title, no quotes or punctuation."
            ),
            messages=[{"role": "user", "content": user_message}],
            max_tokens=30,
            model=settings.LITE_MODEL,
        )
        title = response.text.strip()[:80]
        await emitter.emit(EventType.CONVERSATION_TITLE, {"title": title})
    except Exception:
        logger.warning("title_generation_failed conversation_id=%s", conversation_id)


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@router.post(
    "/conversations",
    response_model=ConversationResponse,
)
async def create_conversation(
    request: Request,
    state: AppState = Depends(get_app_state),
) -> ConversationResponse:
    """Create a new conversation and send the first message.

    Accepts either JSON (MessageRequest) or multipart/form-data with files.
    """
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        message = form.get("message")
        if not message or not str(message).strip():
            raise HTTPException(status_code=422, detail="message must not be empty")
        message = str(message)
        use_planner = str(form.get("use_planner", "false")).lower() == "true"
        selected_skills = _extract_selected_skills(form)
        raw_files = form.getlist("files")
        upload_files = _extract_upload_files(raw_files)
        attachments = await _parse_uploads(upload_files) if upload_files else ()
    else:
        body = MessageRequest(**(await request.json()))
        message = body.message
        use_planner = body.use_planner
        selected_skills = tuple(body.skills)
        attachments = ()

    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    emitter = EventEmitter()

    event_queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue(
        maxsize=_EVENT_QUEUE_MAXSIZE,
    )
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(event_queue, pending_callbacks)
    emitter.subscribe(subscriber)

    persistent_store = PersistentMemoryStore(
        session_factory=state.db_session_factory,
        conversation_id=conv_uuid,
    )

    orchestrator: Any
    executor: Any
    if use_planner:
        orchestrator, executor = _build_planner_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=getattr(state, "skill_registry", None),
        )
    else:
        orchestrator, executor = _build_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=getattr(state, "skill_registry", None),
        )

    entry = ConversationEntry(
        emitter=emitter,
        event_queue=event_queue,
        orchestrator=orchestrator,
        executor=executor,
        pending_callbacks=pending_callbacks,
    )
    entry.subscriber = subscriber
    state.conversations[conversation_id] = entry

    # Persist conversation and register DB subscriber
    async with state.db_session_factory() as session:
        await state.db_repo.create_conversation(
            session, title=message[:80], conversation_id=conv_uuid
        )

    # Visibility barrier: confirm the committed row is readable from a fresh
    # session before any subscriber attempts FK-dependent writes.  Under
    # PostgreSQL READ COMMITTED this almost always succeeds on the first try,
    # but connection-pool timing can cause a brief delay.
    for _attempt in range(10):
        async with state.db_session_factory() as barrier_session:
            if (
                await state.db_repo.get_conversation(barrier_session, conv_uuid)
                is not None
            ):
                break
        await asyncio.sleep(0.05)
    else:
        logger.error("conversation_visibility_timeout id={}", conv_uuid)

    db_sub = create_db_subscriber(
        conv_uuid, state.db_repo, state.db_session_factory, state.db_pending_writes
    )
    emitter.subscribe(db_sub)

    # Start first turn
    entry.turn_task = asyncio.create_task(
        _run_turn(
            state,
            conversation_id,
            orchestrator,
            message,
            attachments,
            selected_skills,
        ),
    )

    # Generate a concise title in the background
    asyncio.create_task(
        _generate_title(state.claude_client, conversation_id, message, emitter),
    )

    logger.info(
        "conversation_created id=%s message=%s skills=%s attachments=%d",
        conversation_id,
        message[:100],
        selected_skills,
        len(attachments),
    )
    return ConversationResponse(conversation_id=conversation_id)


@router.get("/conversations")
async def list_conversations(
    limit: int = 20,
    offset: int = 0,
    search: str | None = None,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """List conversations, paginated, newest first."""
    if limit > 100:
        limit = 100
    items, total = await state.db_repo.list_conversations(
        session, limit=limit, offset=offset, search=search
    )
    return {
        "items": [
            {
                "id": str(item.id),
                "title": item.title,
                "created_at": item.created_at.isoformat(),
                "updated_at": item.updated_at.isoformat(),
            }
            for item in items
        ],
        "total": total,
    }


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationResponse,
)
async def send_message(
    request: Request,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
) -> ConversationResponse:
    """Send a follow-up message in an existing conversation.

    Accepts either JSON (MessageRequest) or multipart/form-data with files.
    """
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        message = form.get("message")
        if not message or not str(message).strip():
            raise HTTPException(status_code=422, detail="message must not be empty")
        message = str(message)
        selected_skills = _extract_selected_skills(form)
        raw_files = form.getlist("files")
        upload_files = _extract_upload_files(raw_files)
        attachments = await _parse_uploads(upload_files) if upload_files else ()
    else:
        body = MessageRequest(**(await request.json()))
        message = body.message
        selected_skills = tuple(body.skills)
        attachments = ()

    entry = state.conversations.get(conversation_id)
    if entry is None:
        entry = await _reconstruct_conversation(state, conversation_id)
        if entry is None:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown conversation: {conversation_id}",
            )

    # Wait for any in-progress turn to finish before starting the next
    if entry.turn_task is not None and not entry.turn_task.done():
        await entry.turn_task

    # Start new turn on the same orchestrator (preserves full history)
    entry.turn_task = asyncio.create_task(
        _run_turn(
            state,
            conversation_id,
            entry.orchestrator,
            message,
            attachments,
            selected_skills,
        ),
    )

    # Touch updated_at timestamp
    try:
        async with state.db_session_factory() as session:
            await state.db_repo.update_conversation(session, uuid.UUID(conversation_id))
    except Exception as exc:
        logger.warning(
            "failed_to_update_conversation_timestamp id=%s error=%s",
            conversation_id,
            exc,
        )

    logger.info("message_sent conversation_id=%s", conversation_id)
    return ConversationResponse(conversation_id=conversation_id)


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """Get all messages for a conversation (for history replay)."""
    conv_uuid = uuid.UUID(conversation_id)
    convo = await state.db_repo.get_conversation(session, conv_uuid)
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = await state.db_repo.get_messages(session, conv_uuid)
    return {
        "conversation_id": str(convo.id),
        "title": convo.title,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "iteration": m.iteration,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }


@router.get("/conversations/{conversation_id}/events")
async def stream_events(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
) -> StreamingResponse:
    """Stream conversation events via Server-Sent Events (long-lived)."""
    entry = state.conversations.get(conversation_id)
    if entry is None:
        entry = await _reconstruct_conversation(state, conversation_id)
        if entry is None:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown conversation: {conversation_id}",
            )

    return StreamingResponse(
        _event_generator(conversation_id, entry),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations/{conversation_id}/events/history")
async def get_conversation_events(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """Return all stored events for a historical conversation."""
    conv_uuid = uuid.UUID(conversation_id)
    convo = await state.db_repo.get_conversation(session, conv_uuid)
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    events = await state.db_repo.get_events(session, conv_uuid)
    return {
        "events": [
            {
                "type": event.event_type,
                "data": event.data,
                "timestamp": event.timestamp.isoformat(),
                "iteration": event.iteration,
            }
            for event in events
        ],
    }


@router.post("/conversations/{conversation_id}/respond")
async def respond_to_prompt(
    body: UserInputRequest,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
) -> dict[str, str]:
    """Submit a user response to an ask_user prompt."""
    entry = state.conversations.get(conversation_id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown conversation: {conversation_id}",
        )

    callback = entry.pending_callbacks.pop(body.request_id, None)
    if callback is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown request: {body.request_id}",
        )

    logger.info(
        "user_response_received conversation_id=%s request_id=%s",
        conversation_id,
        body.request_id,
    )
    callback(body.response)
    return {"status": "ok"}


@router.post("/conversations/{conversation_id}/cancel")
async def cancel_turn(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
) -> dict[str, str]:
    """Cancel the currently running turn.

    Returns immediately after signalling cancellation.  A background task
    force-cancels the turn if it doesn't stop within 5 seconds.
    """
    entry = state.conversations.get(conversation_id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown conversation: {conversation_id}",
        )

    if entry.turn_task is None or entry.turn_task.done():
        return {"status": "no_active_turn"}

    # Signal graceful cancellation via the orchestrator if supported
    orch = entry.orchestrator
    if hasattr(orch, "cancel"):
        orch.cancel()  # type: ignore[union-attr]

    # Force-cancel in background so the HTTP response returns immediately
    turn_task = entry.turn_task

    async def _force_cancel_after_timeout() -> None:
        try:
            await asyncio.wait_for(asyncio.shield(turn_task), timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            turn_task.cancel()
            try:
                await turn_task
            except (asyncio.CancelledError, Exception):
                pass
        logger.info("turn_cancelled conversation_id=%s", conversation_id)

    asyncio.create_task(_force_cancel_after_timeout())
    return {"status": "cancelling"}


@router.post("/conversations/{conversation_id}/retry")
async def retry_turn(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
) -> dict[str, Any]:
    """Cancel the last turn, roll back, and re-run the last user message."""
    entry = state.conversations.get(conversation_id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown conversation: {conversation_id}",
        )

    orch = entry.orchestrator

    # Cancel running turn first if needed
    if entry.turn_task is not None and not entry.turn_task.done():
        if hasattr(orch, "cancel"):
            orch.cancel()  # type: ignore[union-attr]
        try:
            await asyncio.wait_for(asyncio.shield(entry.turn_task), timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            entry.turn_task.cancel()
            try:
                await entry.turn_task
            except (asyncio.CancelledError, Exception):
                pass

    # Get the last user message before rolling back
    if not hasattr(orch, "get_last_user_message"):
        raise HTTPException(
            status_code=400,
            detail="Orchestrator does not support retry",
        )

    last_msg = orch.get_last_user_message()  # type: ignore[union-attr]
    if last_msg is None:
        raise HTTPException(
            status_code=400,
            detail="No user message to retry",
        )

    # Roll back state and reset cancellation
    orch.rollback_to_before_last_user_message()  # type: ignore[union-attr]
    if hasattr(orch, "reset_cancel"):
        orch.reset_cancel()  # type: ignore[union-attr]

    # Start a new turn with the same message and original attachments
    entry.turn_task = asyncio.create_task(
        _run_turn(
            state,
            conversation_id,
            orch,
            last_msg,
            attachments=entry.last_attachments,
            selected_skills=entry.last_selected_skills,
        ),
    )

    logger.info("turn_retried conversation_id=%s", conversation_id)
    return {"status": "retrying", "message": last_msg}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> dict[str, str]:
    """Delete a conversation and clean up in-memory resources."""
    await _cleanup_conversation(state, conversation_id)
    deleted = await state.db_repo.delete_conversation(
        session, uuid.UUID(conversation_id)
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    logger.info("conversation_deleted id=%s", conversation_id)
    return {"status": "ok"}
