"""Conversation route handlers."""

from __future__ import annotations

import asyncio
import os
import re
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import StreamingResponse
from loguru import logger
from starlette.datastructures import UploadFile
from starlette.requests import Request

from agent.llm.client import AnthropicClient
from agent.logging import conversation_log_context
from agent.memory.store import PersistentMemoryStore
from api.dependencies import AppState, get_app_state, get_db_session
from agent.state.schemas import EventRecord
from api.models import (
    ConversationEntry,
    ConversationMetricsResponse,
    ConversationResponse,
    FileAttachment,
    MAX_FILE_SIZE_MB,
    MAX_FILES_PER_MESSAGE,
    MessageRequest,
    UserInputRequest,
)
from api.auth import AuthUser, common_dependencies, get_current_user
from agent.context.compaction import Observer
from agent.context.profiles import (
    CompactionProfile,
    CompactionRuntimeKind,
    resolve_compaction_profile,
)
from api.builders import (
    _build_orchestrator,
    _build_planner_orchestrator,
    build_agent_system_prompt,
    format_verified_facts_prompt_section,
)
from api.sse import _create_queue_subscriber, _event_generator
from api.user_responses import SubmitResponseStatus
from api.events import AgentEvent, EventEmitter, EventType
from api.db_subscriber import create_db_subscriber
from config.settings import get_settings

# UUID pattern for path parameter validation
_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Max event queue size for backpressure
_EVENT_QUEUE_MAXSIZE = 5000
_MAX_TOTAL_UPLOAD_SIZE_MB = 50
_UPLOAD_READ_CHUNK_SIZE = 1024 * 1024
_MCP_RESTORE_MAX_CONCURRENT = 3
_MCP_RESTORE_SEMAPHORE = asyncio.Semaphore(_MCP_RESTORE_MAX_CONCURRENT)

router = APIRouter(dependencies=common_dependencies)

ORCHESTRATOR_AGENT = "agent"
ORCHESTRATOR_PLANNER = "planner"
EXECUTION_SHAPE_SINGLE_AGENT = "single_agent"
EXECUTION_SHAPE_PROMPT_CHAIN = "prompt_chain"
EXECUTION_SHAPE_PARALLEL = "parallel"
EXECUTION_SHAPE_ORCHESTRATOR_WORKERS = "orchestrator_workers"
_LOCALE_COOKIE_NAME = "synapse-locale"
_SUPPORTED_UI_LOCALES = frozenset({"en", "zh-CN", "zh-TW"})
_FOLLOW_UP_ROUTER_CUE_RE = re.compile(
    r"\b("
    r"planner|plan(?:\s+first)?|parallel|sub-?agents?|workers?|delegate|"
    r"decompose|break\s+(?:it|this)\s+down|split\s+(?:it|this)\s+up|"
    r"coordinate|specialist(?:s)?"
    r")\b",
    re.IGNORECASE,
)


class _BootstrapPendingOrchestrator:
    """Placeholder used until the real orchestrator is constructed."""

    async def run(self, *args: Any, **kwargs: Any) -> str:
        raise RuntimeError("Conversation runtime is still bootstrapping")

    def cancel(self) -> None:
        return None

    def reset_cancel(self) -> None:
        return None

    def get_last_user_message(self) -> None:
        return None

    def rollback_to_before_last_user_message(self) -> None:
        return None


class _NoopExecutor:
    """Placeholder executor used before sandbox-backed runtime exists."""

    def __init__(self) -> None:
        self._sandbox_sessions: dict[str, Any] = {}

    async def cleanup(self) -> None:
        return None


def _elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


async def _restore_mcp_servers_background(
    mcp_state: Any,
    session_factory: Any,
    *,
    conversation_id: str,
    user_id: uuid.UUID,
) -> None:
    from api.routes.mcp import _restore_persisted_servers

    started_at = time.perf_counter()
    try:
        async with _MCP_RESTORE_SEMAPHORE:
            await _restore_persisted_servers(
                mcp_state,
                session_factory,
                user_id=user_id,
            )
        logger.info(
            "conversation_runtime_mcp_restored id={} duration_ms={}",
            conversation_id,
            _elapsed_ms(started_at),
        )
    except Exception:
        logger.exception(
            "conversation_runtime_mcp_restore_failed id={}",
            conversation_id,
        )


async def _resolve_user_id(
    auth_user: AuthUser | None,
    state: AppState,
) -> uuid.UUID | None:
    """Resolve a backend user from the auth context.

    Uses find_by_google_id first (read-only), falls back to upsert if user
    does not exist yet. Returns the user's UUID, or None if not authenticated.
    """
    if auth_user is None:
        return None
    async with state.db_session_factory() as session:
        existing = await state.user_repo.find_by_google_id(session, auth_user.google_id)
        if existing is not None:
            return existing.id
        user = await state.user_repo.upsert_from_google(
            session,
            google_id=auth_user.google_id,
            email=auth_user.email,
            name=auth_user.name,
            picture=auth_user.picture,
        )
    return user.id


async def _resolve_turn_locale(
    request: Request,
    state: AppState,
    *,
    auth_user: AuthUser | None,
    user_id: uuid.UUID | None = None,
) -> str | None:
    """Resolve the preferred locale for user-facing turn output."""
    user_repo = getattr(state, "user_repo", None)
    if user_repo is not None:
        async with state.db_session_factory() as session:
            if user_id is not None:
                user = await user_repo.find_by_id(session, user_id)
                if user is not None and user.locale in _SUPPORTED_UI_LOCALES:
                    return user.locale
            elif auth_user is not None:
                user = await user_repo.find_by_google_id(session, auth_user.google_id)
                if user is not None and user.locale in _SUPPORTED_UI_LOCALES:
                    return user.locale

    cookie_locale = request.cookies.get(_LOCALE_COOKIE_NAME)
    if cookie_locale in _SUPPORTED_UI_LOCALES:
        return cookie_locale
    return None


async def _verify_conversation_ownership(
    state: AppState,
    conversation_id: str,
    auth_user: AuthUser | None,
) -> None:
    """Verify the authenticated user owns the conversation.

    Returns 404 (not 403) for unowned resources to prevent enumeration.
    Skipped when auth_user is None (unauthenticated / AUTH_REQUIRED=False).
    """
    if auth_user is None:
        return
    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        return
    async with state.db_session_factory() as session:
        convo = await state.db_repo.get_conversation(
            session, uuid.UUID(conversation_id)
        )
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if convo.user_id is not None and convo.user_id != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")


async def _build_user_skill_registry(
    state: AppState,
    user_id: uuid.UUID | None,
) -> Any:
    """Return a SkillRegistry scoped to bundled + current user's skills.

    Queries the DB for skill names visible to this user, then filters
    the global in-memory registry to only those names.  Falls back to
    the full registry when the DB skill repo is unavailable.
    """
    global_registry = getattr(state, "skill_registry", None)
    if global_registry is None:
        return None

    skill_repo = getattr(state, "skill_repo", None)
    if skill_repo is None:
        return global_registry

    async with state.db_session_factory() as session:
        db_records = await skill_repo.list_skills(session, user_id=user_id)

    if not db_records:
        return global_registry

    visible_names = {r.name for r in db_records if r.enabled}
    return global_registry.filter_by_names(visible_names)


def _entry_runtime_ready(entry: ConversationEntry) -> bool:
    return entry.orchestrator is not None and entry.executor is not None


def _attach_idempotency_tracking(
    entry: ConversationEntry,
    task: asyncio.Task[str],
    *,
    idempotency_key: str | None,
) -> None:
    if not idempotency_key:
        return
    entry.idempotency_tasks[idempotency_key] = task

    def _cleanup(done_task: asyncio.Task[str]) -> None:
        current = entry.idempotency_tasks.get(idempotency_key)
        if current is done_task:
            entry.idempotency_tasks.pop(idempotency_key, None)

    task.add_done_callback(_cleanup)


def _start_turn_task(
    entry: ConversationEntry,
    coroutine: Any,
    *,
    idempotency_key: str | None,
) -> asyncio.Task[str]:
    task = asyncio.create_task(coroutine)
    entry.turn_task = task
    _attach_idempotency_tracking(
        entry,
        task,
        idempotency_key=idempotency_key,
    )
    return task


async def _prepare_conversation_runtime(
    state: AppState,
    *,
    conversation_id: str,
    conv_uuid: uuid.UUID,
    user_id: uuid.UUID | None,
    mode: str,
    emitter: EventEmitter,
    memory_limit: int | None = None,
) -> tuple[Any, Any]:
    started_at = time.perf_counter()
    settings = get_settings()
    persistent_store = PersistentMemoryStore(
        session_factory=state.db_session_factory,
        user_id=user_id,
        conversation_id=conv_uuid,
    )

    effective_memory_limit = memory_limit or settings.INITIAL_CONVERSATION_MEMORY_LIMIT
    memory_task = asyncio.create_task(
        _load_runtime_memory_entries(
            persistent_store,
            memory_limit=effective_memory_limit,
        )
    )
    skill_task = asyncio.create_task(_build_user_skill_registry(state, user_id))
    mcp_enabled = user_id is not None and state.mcp_state is not None

    if mcp_enabled:
        asyncio.create_task(
            _restore_mcp_servers_background(
                state.mcp_state,
                state.db_session_factory,
                conversation_id=conversation_id,
                user_id=user_id,
            )
        )

    memory_entries, user_skill_registry = await asyncio.gather(
        memory_task,
        skill_task,
    )
    logger.info(
        "conversation_runtime_inputs_ready id={} mode={} duration_ms={} memory_entries={} memory_limit={} skill_registry={} mcp_restore_enabled={}",
        conversation_id,
        mode,
        _elapsed_ms(started_at),
        len(memory_entries),
        effective_memory_limit,
        user_skill_registry is not None,
        mcp_enabled,
    )
    if mcp_enabled:
        logger.info("conversation_runtime_mcp_restore_scheduled id={}", conversation_id)

    if mode == ORCHESTRATOR_PLANNER:
        orchestrator_executor = _build_planner_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=user_skill_registry,
            memory_entries=memory_entries,
            conversation_id=conversation_id,
        )
    else:
        orchestrator_executor = _build_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=user_skill_registry,
            memory_entries=memory_entries,
            conversation_id=conversation_id,
        )

    logger.info(
        "conversation_runtime_ready id={} mode={} duration_ms={}",
        conversation_id,
        mode,
        _elapsed_ms(started_at),
    )
    return orchestrator_executor


async def _load_runtime_memory_entries(
    persistent_store: PersistentMemoryStore,
    *,
    memory_limit: int | None = None,
) -> list[dict[str, str]]:
    settings = get_settings()
    effective_limit = memory_limit or settings.INITIAL_CONVERSATION_MEMORY_LIMIT
    return await persistent_store.load_all(limit=effective_limit)


async def _bootstrap_and_run_initial_turn(
    state: AppState,
    *,
    conversation_id: str,
    message: str,
    attachments: tuple[FileAttachment, ...],
    selected_skills: tuple[str, ...],
    explicit_planner: bool | None,
    idempotency_key: str | None,
    user_id: uuid.UUID | None = None,
    turn_locale: str | None = None,
) -> str:
    bootstrap_started_at = time.perf_counter()
    conv_uuid = uuid.UUID(conversation_id)
    entry = state.conversations[conversation_id]

    try:
        # Resolve execution route here (in the background task) so the
        # HTTP response is not blocked by the LLM classification call.
        (
            execution_shape,
            execution_rationale,
            initial_mode,
            auto_detected,
        ) = await _resolve_execution_route(
            state.claude_client,
            message,
            explicit_planner,
        )

        logger.info(
            "conversation_bootstrap_route_ready id={} mode={} shape={} duration_ms={}",
            conversation_id,
            initial_mode,
            execution_shape,
            _elapsed_ms(bootstrap_started_at),
        )

        if auto_detected:
            await entry.emitter.emit(EventType.PLANNER_AUTO_SELECTED, {})

        effective_user_id = user_id

        orchestrator, executor = await _prepare_conversation_runtime(
            state,
            conversation_id=conversation_id,
            conv_uuid=conv_uuid,
            user_id=effective_user_id,
            mode=initial_mode,
            emitter=entry.emitter,
        )
        entry.orchestrator = orchestrator
        entry.executor = executor
        entry.orchestrator_mode = initial_mode

        async with state.db_session_factory() as session:
            await state.db_repo.update_conversation(
                session,
                conv_uuid,
                orchestrator_mode=initial_mode,
            )
        logger.info(
            "conversation_bootstrap_runtime_ready id={} mode={} duration_ms={}",
            conversation_id,
            initial_mode,
            _elapsed_ms(bootstrap_started_at),
        )

        runtime_prompt_sections = _build_execution_shape_prompt_sections(
            execution_shape,
            execution_rationale,
            explicit_planner=explicit_planner is True,
        )
        turn_metadata = {
            "execution_shape": execution_shape,
            "execution_rationale": execution_rationale,
            "explicit_planner": explicit_planner is True,
            **({"locale": turn_locale} if turn_locale else {}),
        }

        result = await _run_turn(
            state,
            conversation_id,
            orchestrator,
            message,
            attachments,
            selected_skills,
            runtime_prompt_sections=runtime_prompt_sections,
            turn_metadata=turn_metadata,
            idempotency_key=idempotency_key,
        )
        logger.info(
            "conversation_bootstrap_turn_finished id={} duration_ms={}",
            conversation_id,
            _elapsed_ms(bootstrap_started_at),
        )
        return result
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception(
            "conversation_bootstrap_failed conversation_id={}", conversation_id
        )
        await entry.emitter.emit(
            EventType.TASK_ERROR,
            {"error": "An internal error occurred. Please try again."},
        )
        return "Error: An internal error occurred."


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
    max_total_bytes = _MAX_TOTAL_UPLOAD_SIZE_MB * 1024 * 1024
    total_bytes = 0
    max_filename_len = 255  # Most filesystems limit to 255 chars

    for f in files:
        chunks: list[bytes] = []
        file_bytes = 0
        while True:
            chunk = await f.read(_UPLOAD_READ_CHUNK_SIZE)
            if not chunk:
                break
            file_bytes += len(chunk)
            total_bytes += len(chunk)
            if file_bytes > max_bytes:
                raise HTTPException(
                    status_code=400,
                    detail=f"File '{f.filename}' exceeds {MAX_FILE_SIZE_MB}MB limit",
                )
            if total_bytes > max_total_bytes:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Uploaded files exceed "
                        f"{_MAX_TOTAL_UPLOAD_SIZE_MB}MB aggregate limit"
                    ),
                )
            chunks.append(chunk)
        data = b"".join(chunks)

        # Check for empty files
        if len(data) == 0:
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' is empty",
            )

        safe_name = _sanitize_filename(f.filename or "unnamed")

        # Check filename length after sanitization
        if len(safe_name) > max_filename_len:
            raise HTTPException(
                status_code=400,
                detail=f"File name exceeds {max_filename_len} characters",
            )

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


def _planner_flag_to_mode(use_planner: bool | None) -> str | None:
    """Convert optional planner flag into orchestrator mode."""
    if use_planner is None:
        return None
    return ORCHESTRATOR_PLANNER if use_planner else ORCHESTRATOR_AGENT


def _default_execution_shape_for_mode(mode: str) -> str:
    if mode == ORCHESTRATOR_PLANNER:
        return EXECUTION_SHAPE_ORCHESTRATOR_WORKERS
    return EXECUTION_SHAPE_SINGLE_AGENT


def _route_shape_to_mode(shape: str) -> str:
    if shape in (
        EXECUTION_SHAPE_PARALLEL,
        EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
    ):
        return ORCHESTRATOR_PLANNER
    return ORCHESTRATOR_AGENT


def _reuse_follow_up_execution_route(
    mode: str,
) -> tuple[str, str, str, bool]:
    shape = _default_execution_shape_for_mode(mode)
    if mode == ORCHESTRATOR_PLANNER:
        rationale = "reused existing planner mode for follow-up turn"
    else:
        rationale = "reused existing single-agent mode for follow-up turn"
    return shape, rationale, mode, False


async def _resolve_follow_up_execution_route(
    claude_client: AnthropicClient,
    entry: ConversationEntry,
    message: str,
    explicit_planner: bool | None,
) -> tuple[str, str, str, bool]:
    forced_mode = _planner_flag_to_mode(explicit_planner)
    if forced_mode is not None:
        rationale = (
            "planner forced by user"
            if forced_mode == ORCHESTRATOR_PLANNER
            else "planner disabled by user"
        )
        return (
            _default_execution_shape_for_mode(forced_mode),
            rationale,
            forced_mode,
            False,
        )

    if _entry_runtime_ready(entry):
        current_mode = entry.orchestrator_mode
        if current_mode == ORCHESTRATOR_PLANNER:
            return _reuse_follow_up_execution_route(current_mode)
        if not _FOLLOW_UP_ROUTER_CUE_RE.search(message):
            return _reuse_follow_up_execution_route(current_mode)

    return await _resolve_execution_route(
        claude_client,
        message,
        explicit_planner,
    )


async def _resolve_execution_route(
    claude_client: AnthropicClient,
    message: str,
    explicit_planner: bool | None,
) -> tuple[str, str, str, bool]:
    """Resolve execution shape and orchestrator mode for a turn.

    Explicit planner choices are treated as hard routing overrides:
    ``True`` forces planner orchestration and ``False`` forces single-agent.
    When the flag is unset, the classifier decides the route.
    """
    forced_mode = _planner_flag_to_mode(explicit_planner)
    if forced_mode == ORCHESTRATOR_PLANNER:
        return (
            EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
            "planner forced by user",
            ORCHESTRATOR_PLANNER,
            False,
        )
    if forced_mode == ORCHESTRATOR_AGENT:
        return (
            EXECUTION_SHAPE_SINGLE_AGENT,
            "planner disabled by user",
            ORCHESTRATOR_AGENT,
            False,
        )

    execution_shape, execution_rationale = await _classify_execution_shape(
        claude_client, message
    )
    orchestrator_mode = _route_shape_to_mode(execution_shape)
    auto_detected = orchestrator_mode == ORCHESTRATOR_PLANNER
    return execution_shape, execution_rationale, orchestrator_mode, auto_detected


def _build_execution_shape_prompt_sections(
    execution_shape: str,
    rationale: str,
    *,
    explicit_planner: bool = False,
) -> tuple[str, ...]:
    settings = get_settings()
    sections: list[str] = [
        (
            "Execution route for this turn:\n"
            f"- execution_shape: {execution_shape}\n"
            f"- rationale: {rationale}"
        )
    ]
    if execution_shape == EXECUTION_SHAPE_SINGLE_AGENT:
        sections.append(
            "Routing guidance: keep ownership in a single agent. Do not decompose into sub-agents."
        )
    elif execution_shape == EXECUTION_SHAPE_PROMPT_CHAIN:
        sections.append(
            "Routing guidance: use a fixed sequential workflow inside one agent. Do not spawn sub-agents."
        )
    elif execution_shape == EXECUTION_SHAPE_PARALLEL:
        sections.append(
            "Routing guidance: only spawn workers for truly independent tasks. "
            f"Worker limit: {settings.EXECUTION_SHAPE_PARALLEL_SOFT_LIMIT}. "
            "Every worker must have a concrete deliverable, ownership scope, and independence reason."
        )
    elif execution_shape == EXECUTION_SHAPE_ORCHESTRATOR_WORKERS:
        sections.append(
            "Routing guidance: planner-managed worker orchestration is allowed, "
            "but only when delegation is materially useful. "
            f"Worker limit: {settings.EXECUTION_SHAPE_ORCHESTRATOR_WORKERS_SOFT_LIMIT}. "
            "Prefer zero workers for direct answers, one worker for bounded execution, "
            "and multiple workers only for independent slices."
        )
    if explicit_planner:
        sections.append(
            "Planner mode was explicitly requested by the user for this turn. "
            "Produce visible planning activity. Call plan_create before finishing unless the turn is trivial or only needs clarification. "
            "Spawn workers only when the plan has a bounded independent worker step, then wait for results and synthesize."
        )
    return tuple(sections)


async def _load_initial_messages_for_conversation(
    state: AppState,
    convo: Any,
    memory_entries: list[dict[str, str]],
    user_skill_registry: Any,
    compaction_profile: CompactionProfile,
) -> list[dict[str, Any]]:
    """Load reconstructed message history in Claude API message format."""
    settings = get_settings()
    conv_uuid = convo.id
    async with state.db_session_factory() as session:
        if convo.context_summary and convo.context_summary.strip():
            db_messages = await state.db_repo.get_recent_messages(
                session,
                conv_uuid,
                compaction_profile.reconstruct_tail_messages,
            )
        else:
            db_messages = await state.db_repo.get_recent_messages(
                session,
                conv_uuid,
                max(
                    compaction_profile.reconstruct_tail_messages,
                    settings.RECONSTRUCT_MAX_MESSAGES_WITHOUT_SUMMARY,
                ),
            )

    initial_messages: list[dict[str, Any]] = []
    if convo.context_summary and convo.context_summary.strip():
        initial_messages.append(
            {
                "role": "assistant",
                "content": "## Earlier sessions (compressed)\n"
                + convo.context_summary.strip(),
            }
        )
    for m in db_messages:
        if m.role not in ("user", "assistant"):
            continue
        content = m.content
        if isinstance(content, list):
            initial_messages.append({"role": m.role, "content": content})
        elif isinstance(content, dict) and "text" in content:
            initial_messages.append({"role": m.role, "content": content["text"]})
        elif isinstance(content, str):
            initial_messages.append({"role": m.role, "content": content})
        else:
            initial_messages.append({"role": m.role, "content": str(content)})

    effective_sp = build_agent_system_prompt(memory_entries, user_skill_registry)
    obs = Observer(
        profile=compaction_profile,
        claude_client=state.claude_client,
        summary_model=compaction_profile.summary_model or settings.LITE_MODEL,
    )
    msg_tuple = tuple(initial_messages)
    if obs.should_compact(msg_tuple, effective_sp):
        msg_tuple = await obs.compact(msg_tuple, effective_sp)
    return list(msg_tuple)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


async def _reconstruct_conversation(
    state: AppState,
    conversation_id: str,
    *,
    compaction_runtime: CompactionRuntimeKind | None = None,
) -> ConversationEntry | None:
    """Reconstruct a conversation from DB history when it's been evicted from memory.

    Returns the new ConversationEntry, or None if the conversation doesn't exist in DB.
    """
    conv_uuid = uuid.UUID(conversation_id)
    async with state.db_session_factory() as session:
        convo = await state.db_repo.get_conversation(session, conv_uuid)
        if convo is None:
            return None
    mode = (
        convo.orchestrator_mode
        if convo.orchestrator_mode in (ORCHESTRATOR_AGENT, ORCHESTRATOR_PLANNER)
        else ORCHESTRATOR_AGENT
    )
    settings = get_settings()
    effective_runtime: CompactionRuntimeKind
    if mode == ORCHESTRATOR_PLANNER:
        effective_runtime = "planner"
    else:
        effective_runtime = compaction_runtime or "web_conversation"
    compaction_profile = resolve_compaction_profile(settings, effective_runtime)

    emitter = EventEmitter(
        conversation_id=conversation_id,
        response_coordinator=getattr(state, "response_coordinator", None),
    )
    event_queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue(
        maxsize=_EVENT_QUEUE_MAXSIZE,
    )
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(event_queue, pending_callbacks)
    emitter.subscribe(subscriber)

    persistent_store = PersistentMemoryStore(
        session_factory=state.db_session_factory,
        user_id=convo.user_id,
        conversation_id=conv_uuid,
    )

    # Load user memories for system prompt injection
    memory_entries = await _load_runtime_memory_entries(persistent_store)

    # Build a user-scoped skill registry for this conversation's owner
    user_skill_registry = await _build_user_skill_registry(state, convo.user_id)
    initial_messages = await _load_initial_messages_for_conversation(
        state,
        convo,
        memory_entries,
        user_skill_registry,
        compaction_profile,
    )
    if mode == ORCHESTRATOR_PLANNER:
        orchestrator, executor = _build_planner_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=user_skill_registry,
            memory_entries=memory_entries,
            conversation_id=conversation_id,
            initial_messages=tuple(initial_messages),
            compaction_profile=compaction_profile,
        )
    else:
        orchestrator, executor = _build_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            initial_messages=tuple(initial_messages),
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=user_skill_registry,
            memory_entries=memory_entries,
            conversation_id=conversation_id,
            compaction_profile=compaction_profile,
        )

    entry = ConversationEntry(
        emitter=emitter,
        event_queue=event_queue,
        orchestrator=orchestrator,
        executor=executor,
        pending_callbacks=pending_callbacks,
        orchestrator_mode=mode,
    )
    entry.subscriber = subscriber
    state.conversations[conversation_id] = entry

    # Re-register DB subscriber for new events
    db_sub = create_db_subscriber(
        conv_uuid,
        state.db_repo,
        state.db_session_factory,
        state.db_pending_writes,
        skill_repo=state.skill_repo,
        prompt_repo=getattr(state, "user_prompt_repo", None),
        user_id=convo.user_id,
        usage_repo=state.usage_repo,
    )
    emitter.subscribe(db_sub)

    logger.info(
        "conversation_reconstructed id={} messages={}",
        conversation_id,
        len(initial_messages),
    )
    return entry


def _has_verified_facts_section(runtime_prompt_sections: tuple[str, ...]) -> bool:
    return any(
        "<verified_user_facts>" in section for section in runtime_prompt_sections
    )


async def _append_relevant_fact_prompt_sections(
    state: AppState,
    conversation_id: str,
    message: str,
    runtime_prompt_sections: tuple[str, ...],
) -> tuple[str, ...]:
    """Add bounded verified facts for web/planner turns when available."""
    if not message.strip() or _has_verified_facts_section(runtime_prompt_sections):
        return runtime_prompt_sections

    try:
        conv_uuid = uuid.UUID(conversation_id)
        async with state.db_session_factory() as session:
            convo = await state.db_repo.get_conversation(session, conv_uuid)
        if convo is None or convo.user_id is None:
            return runtime_prompt_sections

        settings = get_settings()
        persistent_store = PersistentMemoryStore(
            session_factory=state.db_session_factory,
            user_id=convo.user_id,
            conversation_id=conv_uuid,
        )
        facts = await persistent_store.retrieve_relevant_facts(
            query=message,
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
            conversation_id,
        )

    return runtime_prompt_sections


async def _run_turn(
    state: AppState,
    conversation_id: str,
    orchestrator: Any,
    message: str,
    attachments: tuple[FileAttachment, ...] = (),
    selected_skills: tuple[str, ...] = (),
    runtime_prompt_sections: tuple[str, ...] = (),
    turn_metadata: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> str:
    """Run a single turn of the conversation. Does NOT close the SSE connection."""
    try:
        # Store attachments on the entry so retry can re-send them
        entry = state.conversations.get(conversation_id)
        if (
            idempotency_key
            and entry is not None
            and idempotency_key in entry.idempotency_cache
        ):
            logger.info(
                "turn_idempotent_hit conversation_id={} key={}",
                conversation_id,
                idempotency_key[:16],
            )
            return entry.idempotency_cache[idempotency_key]
        if entry is not None and attachments:
            entry.last_attachments = attachments
        if entry is not None:
            entry.last_selected_skills = selected_skills
        # NOTE: file upload to sandbox is now handled inside
        # orchestrator.run() — after skill matching — so that files
        # land in the correct sandbox template (e.g. data_science).
        runtime_prompt_sections = await _append_relevant_fact_prompt_sections(
            state,
            conversation_id,
            message,
            runtime_prompt_sections,
        )

        logger.info("turn_started conversation_id={}", conversation_id)
        result = await orchestrator.run(
            message,
            attachments=attachments,
            selected_skills=selected_skills,
            runtime_prompt_sections=runtime_prompt_sections,
            turn_metadata=turn_metadata,
        )
        logger.info("turn_completed conversation_id={}", conversation_id)
        store_entry = state.conversations.get(conversation_id)
        if idempotency_key and store_entry is not None and result:
            if len(store_entry.idempotency_cache) >= 32:
                drop_key = next(iter(store_entry.idempotency_cache))
                del store_entry.idempotency_cache[drop_key]
            store_entry.idempotency_cache[idempotency_key] = result
        return result
    except asyncio.CancelledError:
        logger.info("turn_cancelled conversation_id={}", conversation_id)
        entry = state.conversations.get(conversation_id)
        if entry is not None:
            await entry.emitter.emit(
                EventType.TURN_CANCELLED,
                {"result": "Turn was cancelled."},
            )
        return "Cancelled."
    except Exception:
        logger.exception("turn_failed conversation_id={}", conversation_id)
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
    if entry.executor is not None:
        try:
            await entry.executor.cleanup()
        except Exception as exc:
            logger.error(
                "cleanup_failed conversation_id={} error={}", conversation_id, str(exc)
            )

    # Drain remaining events
    while not entry.event_queue.empty():
        try:
            entry.event_queue.get_nowait()
        except asyncio.QueueEmpty:
            break

    logger.info("conversation_cleaned_up conversation_id={}", conversation_id)


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
            logger.info("cleaning_stale_conversation id={}", cid)
            await _cleanup_conversation(state, cid)


async def _generate_title(
    claude_client: AnthropicClient,
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
        logger.warning("title_generation_failed conversation_id={}", conversation_id)


_EXECUTION_ROUTER_SYSTEM_PROMPT = (
    "Route the user's request to exactly one execution shape.\n"
    "Valid shapes:\n"
    "- single_agent: one agent should handle the task end-to-end.\n"
    "- prompt_chain: one agent should execute a predictable sequential workflow without sub-agents.\n"
    "- parallel: multiple independent worker tasks can be executed in parallel, then synthesized.\n"
    "- orchestrator_workers: a planner should coordinate workers because decomposition or specialization is open-ended.\n"
    "Default to single_agent unless parallelism or orchestration is clearly justified.\n"
    "Reply in exactly one line using this format:\n"
    "SHAPE|brief rationale"
)


async def _classify_execution_shape(
    claude_client: AnthropicClient,
    user_message: str,
) -> tuple[str, str]:
    """Route a task to an execution shape with a short rationale."""
    try:
        settings = get_settings()
        response = await claude_client.create_message(
            system=_EXECUTION_ROUTER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message[:2000]}],
            max_tokens=40,
            model=(
                settings.EXECUTION_ROUTER_MODEL
                or settings.COMPLEXITY_CLASSIFIER_MODEL
                or settings.LITE_MODEL
            ),
        )
        line = response.text.strip().splitlines()[0] if response.text.strip() else ""
        shape_part, _, rationale_part = line.partition("|")
        shape = shape_part.strip().lower()
        rationale = rationale_part.strip() or "router-selected default"
        allowed = {
            EXECUTION_SHAPE_SINGLE_AGENT,
            EXECUTION_SHAPE_PROMPT_CHAIN,
            EXECUTION_SHAPE_PARALLEL,
            EXECUTION_SHAPE_ORCHESTRATOR_WORKERS,
        }
        if shape not in allowed:
            return EXECUTION_SHAPE_SINGLE_AGENT, "router returned ambiguous output"
        logger.debug(
            "execution_shape verdict={} preview={}",
            response.text.strip(),
            user_message[:80],
        )
        return shape, rationale
    except Exception as exc:
        logger.warning("execution_shape_router_error error={}", exc)
        return EXECUTION_SHAPE_SINGLE_AGENT, "router error: defaulted to single agent"


# ---------------------------------------------------------------------------
# Metrics aggregation
# ---------------------------------------------------------------------------


def _build_conversation_metrics_response(
    conversation_id: str,
    events: list[EventRecord],
) -> ConversationMetricsResponse:
    """Aggregate event records into a conversation metrics summary.

    Processes persisted ``EventRecord`` objects and extracts:
    - Token usage from ``llm_response`` events (``usage.input_tokens`` / ``output_tokens``)
    - Context compaction count from ``context_compacted`` events
    - Per-tool call counts from ``tool_call`` events (``tool_name``)
    - Per-agent metrics from ``agent_complete`` events (``metrics`` dict)
    """
    total_input_tokens = 0
    total_output_tokens = 0
    context_compaction_count = 0
    tool_call_counts: dict[str, int] = {}
    per_agent_metrics: dict[str, dict[str, Any]] = {}

    for event in events:
        etype = event.event_type
        data = event.data

        if etype == "llm_response":
            usage = data.get("usage", {})
            total_input_tokens += usage.get("input_tokens", 0)
            total_output_tokens += usage.get("output_tokens", 0)

        elif etype == "context_compacted":
            context_compaction_count += 1

        elif etype == "tool_call":
            tool_name = data.get("tool_name")
            if tool_name:
                tool_call_counts[tool_name] = tool_call_counts.get(tool_name, 0) + 1

        elif etype == "agent_complete":
            agent_name = data.get("agent_name") or data.get("agent_id") or ""
            if agent_name:
                per_agent_metrics[agent_name] = data.get("metrics", {})

    return ConversationMetricsResponse(
        conversation_id=conversation_id,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        context_compaction_count=context_compaction_count,
        tool_call_counts=tool_call_counts,
        per_agent_metrics=per_agent_metrics,
    )


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
    auth_user: AuthUser | None = Depends(get_current_user),
) -> ConversationResponse:
    """Create a new conversation and send the first message.

    Accepts either JSON (MessageRequest) or multipart/form-data with files.
    """
    request_started_at = time.perf_counter()
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        message = form.get("message")
        if not message or not str(message).strip():
            raise HTTPException(status_code=422, detail="message must not be empty")
        message = str(message)
        use_planner_raw = form.get("use_planner")
        explicit_planner: bool | None = (
            str(use_planner_raw).lower() == "true"
            if use_planner_raw is not None
            else None
        )
        selected_skills = _extract_selected_skills(form)
        raw_files = form.getlist("files")
        upload_files = _extract_upload_files(raw_files)
        attachments = await _parse_uploads(upload_files) if upload_files else ()
    else:
        body = MessageRequest(**(await request.json()))
        message = body.message
        explicit_planner = body.use_planner
        selected_skills = tuple(body.skills)
        attachments = ()
    logger.info(
        "conversation_create_parsed content_type={} duration_ms={} attachments={} skills={} explicit_planner={}",
        content_type or "unknown",
        _elapsed_ms(request_started_at),
        len(attachments),
        len(selected_skills),
        explicit_planner,
    )

    idem_key = (request.headers.get("Idempotency-Key") or "").strip()[:128] or None
    if not idem_key:
        if "multipart/form-data" in content_type:
            raw_ik = form.get("idempotency_key")
            if raw_ik:
                idem_key = str(raw_ik).strip()[:128]
        else:
            if body.idempotency_key:
                idem_key = body.idempotency_key.strip()[:128]

    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    with conversation_log_context(conversation_id):
        emitter = EventEmitter(
            conversation_id=conversation_id,
            response_coordinator=getattr(state, "response_coordinator", None),
        )
        # Use a default mode for the initial entry; the background turn
        # task will resolve the real execution route before running.
        initial_mode = _planner_flag_to_mode(explicit_planner) or ORCHESTRATOR_AGENT

        event_queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue(
            maxsize=_EVENT_QUEUE_MAXSIZE,
        )
        pending_callbacks: dict[str, Any] = {}
        subscriber = _create_queue_subscriber(event_queue, pending_callbacks)
        emitter.subscribe(subscriber)

        entry = ConversationEntry(
            emitter=emitter,
            event_queue=event_queue,
            orchestrator=_BootstrapPendingOrchestrator(),
            executor=_NoopExecutor(),
            pending_callbacks=pending_callbacks,
            orchestrator_mode=initial_mode,
        )
        entry.subscriber = subscriber
        state.conversations[conversation_id] = entry

        user_resolution_started_at = time.perf_counter()
        user_id = await _resolve_user_id(auth_user, state)
        turn_locale = await _resolve_turn_locale(
            request,
            state,
            auth_user=auth_user,
            user_id=user_id,
        )
        logger.info(
            "conversation_create_user_ready id={} duration_ms={} authenticated={}",
            conversation_id,
            _elapsed_ms(user_resolution_started_at),
            user_id is not None,
        )

        # Persist conversation and register DB subscriber
        db_create_started_at = time.perf_counter()
        async with state.db_session_factory() as session:
            await state.db_repo.create_conversation(
                session,
                title=message[:80],
                conversation_id=conv_uuid,
                user_id=user_id,
                orchestrator_mode=initial_mode,
            )
        logger.info(
            "conversation_create_persisted id={} duration_ms={} initial_mode={}",
            conversation_id,
            _elapsed_ms(db_create_started_at),
            initial_mode,
        )

        db_sub = create_db_subscriber(
            conv_uuid,
            state.db_repo,
            state.db_session_factory,
            state.db_pending_writes,
            skill_repo=state.skill_repo,
            prompt_repo=getattr(state, "user_prompt_repo", None),
            user_id=user_id,
            usage_repo=state.usage_repo,
        )
        emitter.subscribe(db_sub)

        # Start first turn — execution route is resolved inside the
        # background task so the HTTP response returns immediately.
        _start_turn_task(
            entry,
            _bootstrap_and_run_initial_turn(
                state,
                conversation_id=conversation_id,
                message=message,
                attachments=attachments,
                selected_skills=selected_skills,
                explicit_planner=explicit_planner,
                idempotency_key=idem_key,
                user_id=user_id,
                turn_locale=turn_locale,
            ),
            idempotency_key=idem_key,
        )

        # Generate a concise title in the background
        asyncio.create_task(
            _generate_title(state.claude_client, conversation_id, message, emitter),
        )

        logger.info(
            "conversation_created id={} message={} skills={} attachments={} request_duration_ms={}",
            conversation_id,
            message[:100],
            selected_skills,
            len(attachments),
            _elapsed_ms(request_started_at),
        )
    return ConversationResponse(conversation_id=conversation_id)


@router.get("/conversations")
async def list_conversations(
    request: Request,
    limit: int = 20,
    offset: int = 0,
    search: str | None = None,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """List conversations, paginated, newest first."""
    if limit > 100:
        limit = 100
    user_id = await _resolve_user_id(auth_user, state)
    items, total = await state.db_repo.list_conversations(
        session, limit=limit, offset=offset, search=search, user_id=user_id
    )
    return {
        "items": [
            {
                "id": str(item.id),
                "title": item.title,
                "orchestrator_mode": item.orchestrator_mode,
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
    auth_user: AuthUser | None = Depends(get_current_user),
) -> ConversationResponse:
    """Send a follow-up message in an existing conversation.

    Accepts either JSON (MessageRequest) or multipart/form-data with files.
    """
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        user_id = await _resolve_user_id(auth_user, state)
        turn_locale = await _resolve_turn_locale(
            request,
            state,
            auth_user=auth_user,
            user_id=user_id,
        )
        content_type = request.headers.get("content-type", "")

        if "multipart/form-data" in content_type:
            form = await request.form()
            message = form.get("message")
            if not message or not str(message).strip():
                raise HTTPException(status_code=422, detail="message must not be empty")
            message = str(message)
            use_planner_raw = form.get("use_planner")
            explicit_planner: bool | None = (
                str(use_planner_raw).lower() == "true"
                if use_planner_raw is not None
                else None
            )
            selected_skills = _extract_selected_skills(form)
            raw_files = form.getlist("files")
            upload_files = _extract_upload_files(raw_files)
            attachments = await _parse_uploads(upload_files) if upload_files else ()
        else:
            body = MessageRequest(**(await request.json()))
            message = body.message
            explicit_planner = body.use_planner
            selected_skills = tuple(body.skills)
            attachments = ()

        idem_key = (request.headers.get("Idempotency-Key") or "").strip()[:128] or None
        if not idem_key:
            if "multipart/form-data" in content_type:
                raw_ik = form.get("idempotency_key")
                if raw_ik:
                    idem_key = str(raw_ik).strip()[:128]
            else:
                if body.idempotency_key:
                    idem_key = body.idempotency_key.strip()[:128]

        entry = state.conversations.get(conversation_id)
        if entry is None:
            entry = await _reconstruct_conversation(state, conversation_id)
            if entry is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Unknown conversation: {conversation_id}",
                )

        auto_detected = False
        while True:
            wait_task: asyncio.Task[str] | None = None
            async with entry.lock:
                if idem_key:
                    if idem_key in entry.idempotency_cache:
                        logger.info(
                            "message_send_idempotent_hit conversation_id={} key={}",
                            conversation_id,
                            idem_key[:16],
                        )
                        return ConversationResponse(conversation_id=conversation_id)
                    in_flight = entry.idempotency_tasks.get(idem_key)
                    if in_flight is not None and not in_flight.done():
                        logger.info(
                            "message_send_idempotent_in_flight conversation_id={} key={}",
                            conversation_id,
                            idem_key[:16],
                        )
                        return ConversationResponse(conversation_id=conversation_id)

                current_turn = entry.turn_task
                if current_turn is not None and not current_turn.done():
                    wait_task = current_turn
                else:
                    (
                        execution_shape,
                        execution_rationale,
                        target_mode,
                        auto_detected,
                    ) = await _resolve_follow_up_execution_route(
                        state.claude_client,
                        entry,
                        message,
                        explicit_planner,
                    )
                    current_mode = entry.orchestrator_mode
                    runtime_prompt_sections = _build_execution_shape_prompt_sections(
                        execution_shape,
                        execution_rationale,
                        explicit_planner=explicit_planner is True,
                    )
                    turn_metadata = {
                        "execution_shape": execution_shape,
                        "execution_rationale": execution_rationale,
                        "explicit_planner": explicit_planner is True,
                        **({"locale": turn_locale} if turn_locale else {}),
                    }

                    if target_mode != current_mode or not _entry_runtime_ready(entry):
                        conv_uuid = uuid.UUID(conversation_id)
                        async with state.db_session_factory() as session:
                            convo = await state.db_repo.get_conversation(
                                session, conv_uuid
                            )
                        if convo is None:
                            raise HTTPException(
                                status_code=404,
                                detail="Conversation not found",
                            )

                        persistent_store = PersistentMemoryStore(
                            session_factory=state.db_session_factory,
                            user_id=convo.user_id,
                            conversation_id=conv_uuid,
                        )
                        memory_entries = await _load_runtime_memory_entries(
                            persistent_store
                        )
                        user_skill_registry = await _build_user_skill_registry(
                            state, convo.user_id
                        )
                        settings = get_settings()
                        compaction_profile = resolve_compaction_profile(
                            settings,
                            (
                                "planner"
                                if target_mode == ORCHESTRATOR_PLANNER
                                else "web_conversation"
                            ),
                        )
                        initial_messages = (
                            await _load_initial_messages_for_conversation(
                                state,
                                convo,
                                memory_entries,
                                user_skill_registry,
                                compaction_profile,
                            )
                        )
                        if target_mode == ORCHESTRATOR_PLANNER:
                            orchestrator, executor = _build_planner_orchestrator(
                                state.claude_client,
                                entry.emitter,
                                state.sandbox_provider,
                                state.storage_backend,
                                persistent_store=persistent_store,
                                mcp_state=state.mcp_state,
                                skill_registry=user_skill_registry,
                                memory_entries=memory_entries,
                                conversation_id=conversation_id,
                                initial_messages=tuple(initial_messages),
                            )
                        else:
                            orchestrator, executor = _build_orchestrator(
                                state.claude_client,
                                entry.emitter,
                                state.sandbox_provider,
                                state.storage_backend,
                                initial_messages=tuple(initial_messages),
                                persistent_store=persistent_store,
                                mcp_state=state.mcp_state,
                                skill_registry=user_skill_registry,
                                memory_entries=memory_entries,
                                conversation_id=conversation_id,
                            )
                        entry.orchestrator = orchestrator
                        entry.executor = executor
                        entry.orchestrator_mode = target_mode
                        async with state.db_session_factory() as session:
                            await state.db_repo.update_conversation(
                                session,
                                conv_uuid,
                                orchestrator_mode=target_mode,
                            )
                        if target_mode != current_mode:
                            logger.info(
                                "conversation_mode_switched id={} from={} to={}",
                                conversation_id,
                                current_mode,
                                target_mode,
                            )

                    entry.last_attachments = attachments
                    entry.last_selected_skills = selected_skills
                    if auto_detected:
                        await entry.emitter.emit(EventType.PLANNER_AUTO_SELECTED, {})
                    _start_turn_task(
                        entry,
                        _run_turn(
                            state,
                            conversation_id,
                            entry.orchestrator,
                            message,
                            attachments,
                            selected_skills,
                            runtime_prompt_sections=runtime_prompt_sections,
                            turn_metadata=turn_metadata,
                            idempotency_key=idem_key,
                        ),
                        idempotency_key=idem_key,
                    )
                    break

            if wait_task is not None:
                await wait_task

        logger.info("message_sent conversation_id={}", conversation_id)
    return ConversationResponse(conversation_id=conversation_id)


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    limit: int = 500,
    offset: int = 0,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Get paginated messages for a conversation (for history replay)."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        conv_uuid = uuid.UUID(conversation_id)
        convo = await state.db_repo.get_conversation(session, conv_uuid)
        if convo is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        messages = await state.db_repo.get_messages(
            session,
            conv_uuid,
            limit=limit,
            offset=offset,
        )
        return {
            "conversation_id": str(convo.id),
            "title": convo.title,
            "limit": limit,
            "offset": offset,
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
    auth_user: AuthUser | None = Depends(get_current_user),
) -> StreamingResponse:
    """Stream conversation events via Server-Sent Events (long-lived)."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
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
    limit: int = 500,
    offset: int = 0,
    latest: bool = True,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Return all stored events for a historical conversation."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        conv_uuid = uuid.UUID(conversation_id)
        convo = await state.db_repo.get_conversation(session, conv_uuid)
        if convo is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        limit = max(1, min(limit, 2000))
        offset = max(0, offset)
        if latest:
            events = await state.db_repo.get_latest_events(
                session,
                conv_uuid,
                limit=limit,
                offset=offset,
            )
        else:
            events = await state.db_repo.get_events(
                session,
                conv_uuid,
                limit=limit,
                offset=offset,
            )
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
            "limit": limit,
            "offset": offset,
            "latest": latest,
        }


@router.get(
    "/conversations/{conversation_id}/metrics",
    response_model=ConversationMetricsResponse,
)
async def get_conversation_metrics(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> ConversationMetricsResponse:
    """Return aggregated metrics for a conversation."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        conv_uuid = uuid.UUID(conversation_id)
        events = await state.db_repo.get_events_for_metrics(session, conv_uuid)
        response = _build_conversation_metrics_response(str(conversation_id), events)
        usage_repo = getattr(state, "usage_repo", None)
        if usage_repo is not None:
            usage = await usage_repo.get_conversation_usage(session, conv_uuid)
            if usage is not None:
                response.total_input_tokens = usage.input_tokens
                response.total_output_tokens = usage.output_tokens
        return response


@router.post("/conversations/{conversation_id}/respond")
async def respond_to_prompt(
    body: UserInputRequest,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, str]:
    """Submit a user response to an ask_user prompt."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        coordinator = state.response_coordinator
        if coordinator is None:
            raise HTTPException(
                status_code=503, detail="Response coordinator unavailable"
            )

        result = await coordinator.submit_response(
            conversation_id=conversation_id,
            request_id=body.request_id,
            response=body.response,
        )
        if result.status == SubmitResponseStatus.ALREADY_RESPONDED:
            raise HTTPException(
                status_code=409,
                detail=f"Request already answered: {body.request_id}",
            )
        if result.status == SubmitResponseStatus.NOT_FOUND:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown request: {body.request_id}",
            )

        logger.info(
            "user_response_received conversation_id={} request_id={}",
            conversation_id,
            body.request_id,
        )
        entry = state.conversations.get(conversation_id)
        if entry is not None:
            entry.pending_callbacks.pop(body.request_id, None)
            await entry.emitter.emit(
                EventType.USER_RESPONSE,
                {
                    "request_id": body.request_id,
                    "response": body.response,
                    "persisted": True,
                },
            )
        return {"status": "ok"}


@router.post("/conversations/{conversation_id}/cancel")
async def cancel_turn(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, str]:
    """Cancel the currently running turn.

    Returns immediately after signalling cancellation.  A background task
    force-cancels the turn if it doesn't stop within 5 seconds.
    """
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        entry = state.conversations.get(conversation_id)
        if entry is None:
            # Conversation was evicted from memory (e.g. SSE reconnect).
            # If it exists in DB there is simply no running turn to cancel.
            entry = await _reconstruct_conversation(state, conversation_id)
            if entry is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Unknown conversation: {conversation_id}",
                )
            return {"status": "no_active_turn"}

        async with entry.lock:
            if entry.turn_task is None or entry.turn_task.done():
                return {"status": "no_active_turn"}

            # Signal graceful cancellation via the orchestrator if supported
            orch = entry.orchestrator
            if orch is not None and hasattr(orch, "cancel"):
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
            logger.info("turn_cancelled conversation_id={}", conversation_id)

        asyncio.create_task(_force_cancel_after_timeout())
        return {"status": "cancelling"}


@router.post("/conversations/{conversation_id}/retry")
async def retry_turn(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    """Cancel the last turn, roll back, and re-run the last user message."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        entry = state.conversations.get(conversation_id)
        if entry is None:
            entry = await _reconstruct_conversation(state, conversation_id)
            if entry is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Unknown conversation: {conversation_id}",
                )

        async with entry.lock:
            orch = entry.orchestrator
            if orch is None:
                raise HTTPException(
                    status_code=409,
                    detail="Conversation runtime is not ready yet",
                )

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
            if not hasattr(orch, "get_last_user_message") or not hasattr(
                orch, "rollback_to_before_last_user_message"
            ):
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
            orch.rollback_to_before_last_user_message()  # type: ignore[attr-defined,union-attr]
            if hasattr(orch, "reset_cancel"):
                orch.reset_cancel()  # type: ignore[union-attr]

            # Start a new turn with the same message and original attachments
            _start_turn_task(
                entry,
                _run_turn(
                    state,
                    conversation_id,
                    orch,
                    last_msg,
                    attachments=entry.last_attachments,
                    selected_skills=entry.last_selected_skills,
                ),
                idempotency_key=None,
            )

        logger.info("turn_retried conversation_id={}", conversation_id)
        return {"status": "retrying", "message": last_msg}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, str]:
    """Delete a conversation and clean up in-memory resources."""
    with conversation_log_context(conversation_id):
        await _verify_conversation_ownership(state, conversation_id, auth_user)
        await _cleanup_conversation(state, conversation_id)
        deleted = await state.db_repo.delete_conversation(
            session, uuid.UUID(conversation_id)
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Conversation not found")
        logger.info("conversation_deleted id={}", conversation_id)
        return {"status": "ok"}
