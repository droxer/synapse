"""Versioned server-to-server integration API."""

from __future__ import annotations

import asyncio
import html
import hashlib
import hmac
import json
import os
import time as _time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy.exc import IntegrityError

from agent.context.profiles import resolve_compaction_profile
from agent.artifacts.storage import LocalStorageBackend
from agent.state.schemas import AgentRunRecord, EventRecord
from agent.runtime.hooks import ConversationSessionContext
from api.db_subscriber import create_db_subscriber
from api.dependencies import AppState, get_app_state, get_db_session
from api.events import AgentEvent, EventEmitter, EventType
from api.models import ConversationEntry, UserInputRequest
from api.user_responses import SubmitResponseStatus
from api.routes.conversations import (
    ORCHESTRATOR_AGENT,
    ORCHESTRATOR_PLANNER,
    _BootstrapPendingOrchestrator,
    _NoopExecutor,
    _build_execution_shape_prompt_sections,
    _build_user_skill_registry,
    _entry_runtime_ready,
    _get_conversation_hooks,
    _memory_resources_from_session_hooks,
    _load_initial_messages_for_conversation,
    _reconstruct_conversation,
    _resolve_follow_up_execution_route,
    _resolve_turn_locale,
    _run_turn,
    _start_turn_task,
    _bootstrap_and_run_initial_turn,
)
from api.builders import _build_orchestrator, _build_planner_orchestrator
from api.sse import _create_queue_subscriber
from config.settings import get_settings

_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
_EVENT_QUEUE_MAXSIZE = 5000
_TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
_V1_RATE_LIMIT_WINDOW_SECONDS = 60

router = APIRouter(prefix="/v1", tags=["public-v1"])


class V1ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class V1ErrorResponse(BaseModel):
    error: V1ErrorBody


class AgentRunCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(max_length=100_000)
    skills: list[str] = Field(default_factory=list)
    use_planner: bool | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be empty")
        return value


class AgentMessageCreateRequest(AgentRunCreateRequest):
    pass


class AgentRunResponse(BaseModel):
    run_id: str
    conversation_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class AgentRunResultResponse(BaseModel):
    run_id: str
    conversation_id: str
    status: Literal["completed"]
    content: str
    format: Literal["text"]
    artifact_ids: list[str] = Field(default_factory=list)


class ArtifactResponse(BaseModel):
    id: str
    name: str
    original_name: str
    content_type: str
    size: int
    file_path: str | None = None
    created_at: datetime


class ArtifactListResponse(BaseModel):
    artifacts: list[ArtifactResponse]


@dataclass(frozen=True)
class IntegrationAuth:
    api_key_hash: str


class _IntegrationRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._requests: dict[str, list[float]] = {}
        self._last_sweep = 0.0

    def check(self, key: str) -> bool:
        now = _time.monotonic()
        window_start = now - self._window
        if now - self._last_sweep >= self._window:
            self._last_sweep = now
            expired = [
                candidate
                for candidate, timestamps in self._requests.items()
                if not timestamps or timestamps[-1] <= window_start
            ]
            for candidate in expired:
                self._requests.pop(candidate, None)
        requests = [t for t in self._requests.get(key, []) if t > window_start]
        if len(requests) >= self._max:
            self._requests[key] = requests
            return False
        requests.append(now)
        self._requests[key] = requests
        return True


_v1_rate_limiters: dict[int, _IntegrationRateLimiter] = {}


def _hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def _configured_api_keys() -> tuple[str, ...]:
    settings = get_settings()
    return tuple(key.strip() for key in settings.API_KEYS.split(",") if key.strip())


def _public_error(
    status_code: int,
    code: str,
    message: str,
    details: Any | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": {"code": code, "message": message, "details": details}},
    )


async def require_integration_api_key(
    authorization: str | None = Header(default=None),
) -> IntegrationAuth:
    configured_keys = _configured_api_keys()
    if not configured_keys:
        raise _public_error(
            503,
            "integration_api_not_configured",
            "Integration API keys are not configured.",
        )
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _public_error(401, "unauthorized", "Missing bearer token.")
    if not any(hmac.compare_digest(token, candidate) for candidate in configured_keys):
        raise _public_error(401, "unauthorized", "Invalid bearer token.")
    return IntegrationAuth(api_key_hash=_hash_api_key(token))


async def require_v1_rate_limit(
    auth: IntegrationAuth = Depends(require_integration_api_key),
) -> IntegrationAuth:
    settings = get_settings()
    max_requests = settings.RATE_LIMIT_PER_MINUTE
    if max_requests <= 0:
        return auth
    limiter = _v1_rate_limiters.get(max_requests)
    if limiter is None:
        limiter = _IntegrationRateLimiter(
            max_requests=max_requests,
            window_seconds=_V1_RATE_LIMIT_WINDOW_SECONDS,
        )
        _v1_rate_limiters[max_requests] = limiter
    if not limiter.check(auth.api_key_hash):
        raise _public_error(
            429,
            "rate_limited",
            "Integration API rate limit exceeded.",
            {"limit_per_minute": max_requests},
        )
    return auth


def _run_response(record: AgentRunRecord) -> AgentRunResponse:
    updated_at = record.updated_at or record.created_at
    status = record.status
    if status not in _TERMINAL_STATUSES and status not in {"queued", "running"}:
        status = "running"
    return AgentRunResponse(
        run_id=str(record.id),
        conversation_id=str(record.conversation_id),
        status=status,  # type: ignore[arg-type]
        result=record.result,
        error=record.error,
        created_at=record.created_at,
        updated_at=updated_at,
    )


def _idempotency_key(value: str | None) -> str | None:
    clean = (value or "").strip()
    return clean[:128] or None


def _request_fingerprint(
    *,
    operation: Literal["create", "message"],
    body: AgentRunCreateRequest,
    conversation_id: str | None = None,
) -> str:
    payload = {
        "operation": operation,
        "conversation_id": conversation_id,
        "message": body.message,
        "skills": body.skills,
        "use_planner": body.use_planner,
        "metadata": body.metadata,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _run_config(
    *,
    operation: Literal["create", "message"],
    body: AgentRunCreateRequest,
    request_fingerprint: str,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    return {
        "operation": operation,
        "conversation_id": conversation_id,
        "message": body.message,
        "skills": body.skills,
        "use_planner": body.use_planner,
        "metadata": body.metadata,
        "request_fingerprint": request_fingerprint,
    }


def _validate_idempotent_reuse(
    existing: AgentRunRecord,
    *,
    operation: Literal["create", "message"],
    request_fingerprint: str,
) -> None:
    config = existing.config or {}
    existing_operation = config.get("operation")
    existing_fingerprint = config.get("request_fingerprint")
    if existing_operation != operation:
        raise _public_error(
            409,
            "idempotency_conflict",
            "Idempotency key was already used for a different operation.",
        )
    if existing_fingerprint is not None and existing_fingerprint != request_fingerprint:
        raise _public_error(
            409,
            "idempotency_conflict",
            "Idempotency key was already used with a different request payload.",
        )


def _result_status(result: str) -> tuple[str, dict[str, Any] | None]:
    if result == "Cancelled.":
        return "cancelled", {"code": "cancelled", "message": "Run was cancelled."}
    if result.startswith("Error:"):
        return "failed", {
            "code": "agent_error",
            "message": result.removeprefix("Error:").strip(),
        }
    return "completed", None


async def _mark_run_finished(
    state: AppState,
    run_id: uuid.UUID,
    result: str,
) -> None:
    status, error = _result_status(result)
    async with state.db_session_factory() as session:
        await state.db_repo.update_agent_run(
            session,
            run_id,
            status=status,
            result={"message": result} if status == "completed" else None,
            error=error,
        )


async def _mark_run_failed(
    state: AppState,
    run_id: uuid.UUID,
    message: str,
    *,
    code: str = "internal_error",
) -> None:
    async with state.db_session_factory() as session:
        await state.db_repo.update_agent_run(
            session,
            run_id,
            status="failed",
            error={"code": code, "message": message},
        )


async def _mark_run_cancelled(
    state: AppState,
    run_id: uuid.UUID,
    message: str = "Run was cancelled.",
) -> None:
    async with state.db_session_factory() as session:
        await state.db_repo.update_agent_run(
            session,
            run_id,
            status="cancelled",
            error={"code": "cancelled", "message": message},
        )


async def _run_public_initial_turn(
    state: AppState,
    *,
    run_id: uuid.UUID,
    conversation_id: str,
    message: str,
    selected_skills: tuple[str, ...],
    explicit_planner: bool | None,
    idempotency_key: str | None,
    turn_locale: str | None,
) -> None:
    async with state.db_session_factory() as session:
        await state.db_repo.update_agent_run(session, run_id, status="running")
    try:
        result = await _bootstrap_and_run_initial_turn(
            state,
            conversation_id=conversation_id,
            message=message,
            attachments=(),
            selected_skills=selected_skills,
            explicit_planner=explicit_planner,
            idempotency_key=idempotency_key,
            user_id=None,
            turn_locale=turn_locale,
            extra_turn_metadata={"run_id": str(run_id)},
            turn_id=str(run_id),
            source="v1",
        )
        await _mark_run_finished(state, run_id, result)
    except asyncio.CancelledError:
        await _mark_run_cancelled(state, run_id)
        raise
    except Exception:
        await _mark_run_failed(state, run_id, "An internal error occurred.")


async def _ensure_entry(
    state: AppState,
    conversation_id: str,
) -> ConversationEntry:
    entry = state.conversations.get(conversation_id)
    if entry is not None:
        return entry
    entry = await _reconstruct_conversation(state, conversation_id)
    if entry is None:
        raise _public_error(404, "not_found", "Conversation not found.")
    return entry


async def _switch_runtime_if_needed(
    state: AppState,
    entry: ConversationEntry,
    *,
    conversation_id: str,
    target_mode: str,
) -> None:
    current_mode = entry.orchestrator_mode
    if target_mode == current_mode and _entry_runtime_ready(entry):
        return

    conv_uuid = uuid.UUID(conversation_id)
    async with state.db_session_factory() as session:
        convo = await state.db_repo.get_conversation(session, conv_uuid)
    if convo is None:
        raise _public_error(404, "not_found", "Conversation not found.")

    compaction_runtime = (
        "planner" if target_mode == ORCHESTRATOR_PLANNER else "web_conversation"
    )
    session_resources = await _get_conversation_hooks(state).before_session_start(
        ConversationSessionContext(
            conversation_id=conversation_id,
            user_id=convo.user_id,
            mode=target_mode,
            compaction_runtime=compaction_runtime,
            state=state,
            metadata={"db_session_factory": state.db_session_factory},
        )
    )
    persistent_store, memory_entries = _memory_resources_from_session_hooks(
        session_resources
    )
    user_skill_registry = await _build_user_skill_registry(state, convo.user_id)
    compaction_profile = resolve_compaction_profile(
        get_settings(),
        compaction_runtime,
    )
    initial_messages = await _load_initial_messages_for_conversation(
        state,
        convo,
        memory_entries,
        user_skill_registry,
        compaction_profile,
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
            mcp_user_id=convo.user_id,
            conversation_hooks=_get_conversation_hooks(state),
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
            mcp_user_id=convo.user_id,
            conversation_hooks=_get_conversation_hooks(state),
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


async def _run_public_followup_turn(
    state: AppState,
    *,
    run_id: uuid.UUID,
    conversation_id: str,
    message: str,
    selected_skills: tuple[str, ...],
    explicit_planner: bool | None,
    idempotency_key: str | None,
    turn_locale: str | None,
) -> None:
    async with state.db_session_factory() as session:
        await state.db_repo.update_agent_run(session, run_id, status="running")
    try:
        entry = await _ensure_entry(state, conversation_id)
        async with entry.lock:
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
            await _switch_runtime_if_needed(
                state,
                entry,
                conversation_id=conversation_id,
                target_mode=target_mode,
            )
            if auto_detected:
                await entry.emitter.emit(
                    EventType.PLANNER_AUTO_SELECTED,
                    {"run_id": str(run_id)},
                )
            runtime_prompt_sections = _build_execution_shape_prompt_sections(
                execution_shape,
                execution_rationale,
                explicit_planner=explicit_planner is True,
            )
            turn_metadata = {
                "run_id": str(run_id),
                "execution_shape": execution_shape,
                "execution_rationale": execution_rationale,
                "explicit_planner": explicit_planner is True,
                **({"locale": turn_locale} if turn_locale else {}),
            }
        result = await _run_turn(
            state,
            conversation_id,
            entry.orchestrator,
            message,
            (),
            selected_skills,
            runtime_prompt_sections=runtime_prompt_sections,
            turn_metadata=turn_metadata,
            idempotency_key=idempotency_key,
            user_id=None,
            turn_id=str(run_id),
            source="v1",
        )
        await _mark_run_finished(state, run_id, result)
    except asyncio.CancelledError:
        await _mark_run_cancelled(state, run_id)
        raise
    except Exception:
        await _mark_run_failed(state, run_id, "An internal error occurred.")


def _map_public_event_type(event_type: str) -> str | None:
    mapping = {
        EventType.TURN_START.value: "run.started",
        EventType.THINKING.value: "reasoning",
        EventType.TEXT_DELTA.value: "message.delta",
        EventType.TOOL_CALL.value: "tool.started",
        EventType.TOOL_RESULT.value: "tool.completed",
        EventType.SKILL_ACTIVATED.value: "skill.activated",
        EventType.SKILL_SETUP_FAILED.value: "skill.failed",
        EventType.SKILL_DEPENDENCY_FAILED.value: "skill.failed",
        EventType.PLAN_CREATED.value: "plan.created",
        EventType.TURN_COMPLETE.value: "run.completed",
        EventType.TASK_COMPLETE.value: "run.completed",
        EventType.TASK_ERROR.value: "run.failed",
        EventType.TURN_CANCELLED.value: "run.cancelled",
        EventType.ARTIFACT_CREATED.value: "artifact.created",
        EventType.ASK_USER.value: "input.required",
        EventType.USER_RESPONSE.value: "input.submitted",
    }
    return mapping.get(event_type)


def _public_event_payload(
    *,
    event_type: str,
    data: dict[str, Any],
    timestamp: Any,
    iteration: int | None,
    run_id: str,
    conversation_id: str,
) -> dict[str, Any] | None:
    public_type = _map_public_event_type(event_type)
    if public_type is None:
        return None
    public_data: dict[str, Any]
    if public_type == "run.started":
        public_data = {"message": data.get("message", "")}
    elif public_type == "reasoning":
        public_data = {
            "text": data.get("thinking")
            or data.get("text")
            or data.get("content")
            or "",
            "duration_ms": data.get("duration_ms"),
        }
    elif public_type == "message.delta":
        public_data = {"delta": data.get("delta", "")}
    elif public_type == "tool.started":
        tool_name = data.get("tool_name") or data.get("name")
        public_data = {
            "tool_name": tool_name,
            "tool_call_id": data.get("tool_call_id")
            or data.get("tool_id")
            or data.get("id"),
            "tool_input": data.get("tool_input")
            or data.get("input")
            or data.get("arguments")
            or {},
            "category": _public_tool_category(str(tool_name or "")),
        }
    elif public_type == "tool.completed":
        tool_name = data.get("tool_name") or data.get("name")
        public_data = {
            "tool_name": tool_name,
            "tool_call_id": data.get("tool_call_id")
            or data.get("tool_id")
            or data.get("id"),
            "success": data.get("success"),
            "output_preview": _public_preview(data.get("output") or data.get("result")),
            "artifact_ids": list(data.get("artifact_ids") or ()),
            "content_type": data.get("content_type"),
            "category": _public_tool_category(str(tool_name or "")),
        }
    elif public_type == "skill.activated":
        public_data = {
            "name": data.get("name"),
            "source": data.get("source"),
        }
    elif public_type == "skill.failed":
        public_data = {
            "name": data.get("name"),
            "phase": data.get("phase"),
            "error": data.get("error"),
            "source": data.get("source"),
            "manager": data.get("manager"),
            "packages": data.get("packages"),
        }
    elif public_type == "plan.created":
        public_data = {"steps": list(data.get("steps") or ())}
    elif public_type == "artifact.created":
        public_data = {
            "artifact_id": data.get("artifact_id"),
            "name": data.get("name"),
            "content_type": data.get("content_type"),
            "size": data.get("size"),
            "file_path": data.get("file_path"),
        }
    elif public_type == "input.required":
        public_data = {
            "request_id": data.get("request_id") or data.get("_request_id"),
            "question": data.get("question", ""),
            "prompt_kind": data.get("prompt_kind", "freeform"),
            "title": data.get("title"),
            "options": data.get("options"),
            "metadata": data.get("prompt_metadata"),
        }
    elif public_type == "input.submitted":
        public_data = {
            "request_id": data.get("request_id") or data.get("_request_id"),
            "response": data.get("response", ""),
        }
    elif public_type in {"run.failed", "run.cancelled"}:
        public_data = {
            "error": {
                "code": data.get("code")
                or ("cancelled" if public_type == "run.cancelled" else "agent_error"),
                "message": data.get("error")
                or data.get("result")
                or (
                    "Run was cancelled."
                    if public_type == "run.cancelled"
                    else "Run failed."
                ),
                "retryable": data.get("retryable"),
            }
        }
    else:
        public_data = {
            "result": data.get("result"),
            "artifact_ids": list(data.get("artifact_ids") or ()),
        }
    return {
        "event_type": public_type,
        "run_id": run_id,
        "conversation_id": conversation_id,
        "data": public_data,
        "timestamp": timestamp.isoformat()
        if hasattr(timestamp, "isoformat")
        else timestamp,
        "iteration": iteration,
    }


def _public_tool_category(tool_name: str) -> str:
    if "__" in tool_name or tool_name.startswith("mcp_"):
        return "mcp"
    if tool_name in {"activate_skill"}:
        return "skill"
    if tool_name.startswith("agent_") or tool_name in {"spawn_agent", "wait_agent"}:
        return "agent"
    return "tool"


def _public_preview(value: Any, *, max_chars: int = 1200) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except TypeError:
            text = str(value)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1] + "…"


def _sse(public_event: dict[str, Any]) -> str:
    return (
        f"event: {public_event['event_type']}\n"
        f"data: {json.dumps(public_event, default=str)}\n\n"
    )


def _ndjson(public_event: dict[str, Any]) -> str:
    return json.dumps(public_event, default=str) + "\n"


def _stream_chunk(
    public_event: dict[str, Any],
    *,
    stream_format: Literal["sse", "ndjson"],
) -> str:
    if stream_format == "ndjson":
        return _ndjson(public_event)
    return _sse(public_event)


def _done_chunk(*, stream_format: Literal["sse", "ndjson"]) -> str:
    if stream_format == "ndjson":
        return json.dumps({"event_type": "done", "data": {}}) + "\n"
    return "event: done\ndata: {}\n\n"


def _keepalive_chunk(*, stream_format: Literal["sse", "ndjson"]) -> str:
    if stream_format == "ndjson":
        return json.dumps({"event_type": "keepalive", "data": {}}) + "\n"
    return ": keepalive\n\n"


def _events_for_run(
    events: list[EventRecord],
    *,
    run_id: str,
) -> list[EventRecord]:
    start: int | None = None
    for index, event in enumerate(events):
        if (
            event.event_type == EventType.TURN_START.value
            and event.data.get("run_id") == run_id
        ):
            start = index
            break
    if start is None:
        return []
    end = len(events)
    for index in range(start + 1, len(events)):
        if events[index].event_type == EventType.TURN_START.value:
            end = index
            break
    return events[start:end]


async def _latest_run_record(
    state: AppState,
    run_id: uuid.UUID,
    *,
    api_key_hash: str | None = None,
) -> AgentRunRecord | None:
    async with state.db_session_factory() as session:
        return await state.db_repo.get_agent_run(
            session,
            run_id,
            api_key_hash=api_key_hash,
        )


def _event_starts_run(event: AgentEvent | EventRecord, run_id: str) -> bool:
    event_type = event.type.value if isinstance(event, AgentEvent) else event.event_type
    return (
        event_type == EventType.TURN_START.value and event.data.get("run_id") == run_id
    )


def _event_belongs_to_live_run(
    event: AgentEvent,
    *,
    run_id: str,
    run_started: bool,
) -> bool:
    event_run_id = event.data.get("run_id")
    if event_run_id is not None:
        return event_run_id == run_id
    return run_started


def _artifact_ids_from_events(events: list[EventRecord], *, run_id: str) -> list[str]:
    artifact_ids: list[str] = []
    for event in _events_for_run(events, run_id=run_id):
        if event.event_type in {
            EventType.TURN_COMPLETE.value,
            EventType.TASK_COMPLETE.value,
        }:
            for artifact_id in event.data.get("artifact_ids") or ():
                if isinstance(artifact_id, str) and artifact_id not in artifact_ids:
                    artifact_ids.append(artifact_id)
        if event.event_type == EventType.ARTIFACT_CREATED.value:
            artifact_id = event.data.get("artifact_id")
            if isinstance(artifact_id, str) and artifact_id not in artifact_ids:
                artifact_ids.append(artifact_id)
    return artifact_ids


async def _artifact_ids_for_run(state: AppState, record: AgentRunRecord) -> list[str]:
    result = record.result or {}
    result_artifacts = result.get("artifact_ids")
    if isinstance(result_artifacts, list):
        return [value for value in result_artifacts if isinstance(value, str)]
    async with state.db_session_factory() as session:
        events = await state.db_repo.get_events(session, record.conversation_id)
    return _artifact_ids_from_events(events, run_id=str(record.id))


async def _conversation_allowed_for_api_key(
    state: AppState,
    conversation_id: uuid.UUID,
    api_key_hash: str,
) -> bool:
    async with state.db_session_factory() as session:
        return await state.db_repo.conversation_has_agent_run_for_api_key(
            session,
            conversation_id=conversation_id,
            api_key_hash=api_key_hash,
        )


async def _public_event_generator(
    state: AppState,
    run: AgentRunRecord,
    *,
    stream_format: Literal["sse", "ndjson"] = "sse",
) -> AsyncGenerator[str, None]:
    run_id = str(run.id)
    conversation_id = str(run.conversation_id)
    async with state.db_session_factory() as session:
        historical = await state.db_repo.get_events(session, run.conversation_id)
    historical_for_run = _events_for_run(historical, run_id=run_id)
    yielded_event_ids: set[int] = set()
    for event in historical_for_run:
        yielded_event_ids.add(event.id)
        payload = _public_event_payload(
            event_type=event.event_type,
            data=event.data,
            timestamp=event.timestamp,
            iteration=event.iteration,
            run_id=run_id,
            conversation_id=conversation_id,
        )
        if payload is not None:
            yield _stream_chunk(payload, stream_format=stream_format)

    if run.status in _TERMINAL_STATUSES:
        yield _done_chunk(stream_format=stream_format)
        return

    entry = await _ensure_entry(state, conversation_id)
    queue: asyncio.Queue[AgentEvent] = asyncio.Queue(maxsize=1000)
    run_started = bool(historical_for_run)

    async def _subscriber(event: AgentEvent) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            return

    entry.emitter.subscribe(_subscriber)
    try:
        latest = await _latest_run_record(state, run.id)
        if latest is not None and latest.status in _TERMINAL_STATUSES:
            async with state.db_session_factory() as session:
                fresh_events = await state.db_repo.get_events(
                    session,
                    run.conversation_id,
                )
            for event in _events_for_run(fresh_events, run_id=run_id):
                if event.id in yielded_event_ids:
                    continue
                payload = _public_event_payload(
                    event_type=event.event_type,
                    data=event.data,
                    timestamp=event.timestamp,
                    iteration=event.iteration,
                    run_id=run_id,
                    conversation_id=conversation_id,
                )
                if payload is not None:
                    yield _stream_chunk(payload, stream_format=stream_format)
            yield _done_chunk(stream_format=stream_format)
            return

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300.0)
            except asyncio.TimeoutError:
                latest = await _latest_run_record(state, run.id)
                if latest is not None and latest.status in _TERMINAL_STATUSES:
                    yield _done_chunk(stream_format=stream_format)
                    return
                yield _keepalive_chunk(stream_format=stream_format)
                continue
            if _event_starts_run(event, run_id):
                run_started = True
            if not _event_belongs_to_live_run(
                event,
                run_id=run_id,
                run_started=run_started,
            ):
                continue
            payload = _public_event_payload(
                event_type=event.type.value,
                data=event.data,
                timestamp=event.timestamp,
                iteration=event.iteration,
                run_id=run_id,
                conversation_id=conversation_id,
            )
            if payload is None:
                continue
            yield _stream_chunk(payload, stream_format=stream_format)
            if payload["event_type"] in {
                "run.completed",
                "run.failed",
                "run.cancelled",
            }:
                yield _done_chunk(stream_format=stream_format)
                return
    finally:
        entry.emitter.unsubscribe(_subscriber)


def _completed_result_text(record: AgentRunRecord) -> str:
    result = record.result or {}
    message = result.get("message")
    return message if isinstance(message, str) else ""


def _html_result_document(record: AgentRunRecord, content: str) -> str:
    escaped_content = html.escape(content)
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>Agent Run {record.id}</title>"
        "<style>"
        "body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"
        "'Segoe UI',sans-serif;margin:0;background:#f7f7f4;color:#191917;}"
        "main{max-width:900px;margin:0 auto;padding:32px 20px;}"
        "header{font-size:13px;color:#666;margin-bottom:18px;}"
        "article{white-space:pre-wrap;line-height:1.55;font-size:16px;}"
        "</style></head><body><main>"
        f"<header>run_id: {html.escape(str(record.id))}</header>"
        f"<article>{escaped_content}</article>"
        "</main></body></html>"
    )


@router.post(
    "/agent-runs",
    response_model=AgentRunResponse,
    responses={401: {"model": V1ErrorResponse}, 422: {"model": V1ErrorResponse}},
    status_code=202,
)
async def create_agent_run(
    body: AgentRunCreateRequest,
    request: Request,
    idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> AgentRunResponse:
    idem_key = _idempotency_key(idempotency_header)
    request_fingerprint = _request_fingerprint(operation="create", body=body)
    if idem_key is not None:
        async with state.db_session_factory() as session:
            existing = await state.db_repo.get_agent_run_by_idempotency(
                session,
                api_key_hash=auth.api_key_hash,
                idempotency_key=idem_key,
            )
        if existing is not None:
            _validate_idempotent_reuse(
                existing,
                operation="create",
                request_fingerprint=request_fingerprint,
            )
            return _run_response(existing)

    conversation_id = str(uuid.uuid4())
    conv_uuid = uuid.UUID(conversation_id)
    run_id = uuid.uuid4()
    initial_mode = (
        ORCHESTRATOR_PLANNER if body.use_planner is True else ORCHESTRATOR_AGENT
    )
    async with state.db_session_factory() as session:
        await state.db_repo.create_conversation(
            session,
            title=body.message[:80],
            conversation_id=conv_uuid,
            user_id=None,
            orchestrator_mode=initial_mode,
        )
    try:
        async with state.db_session_factory() as session:
            run = await state.db_repo.create_agent_run(
                session,
                run_id=run_id,
                conversation_id=conv_uuid,
                api_key_hash=auth.api_key_hash,
                idempotency_key=idem_key,
                status="queued",
                config=_run_config(
                    operation="create",
                    body=body,
                    request_fingerprint=request_fingerprint,
                ),
            )
    except IntegrityError:
        async with state.db_session_factory() as session:
            await state.db_repo.delete_conversation(session, conv_uuid)
        if idem_key is None:
            raise
        async with state.db_session_factory() as session:
            existing = await state.db_repo.get_agent_run_by_idempotency(
                session,
                api_key_hash=auth.api_key_hash,
                idempotency_key=idem_key,
            )
        if existing is None:
            raise
        _validate_idempotent_reuse(
            existing,
            operation="create",
            request_fingerprint=request_fingerprint,
        )
        return _run_response(existing)

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
    db_sub = create_db_subscriber(
        conv_uuid,
        state.db_repo,
        state.db_session_factory,
        state.db_pending_writes,
        skill_repo=state.skill_repo,
        prompt_repo=getattr(state, "user_prompt_repo", None),
        user_id=None,
        usage_repo=state.usage_repo,
    )
    emitter.subscribe(db_sub)
    turn_locale = await _resolve_turn_locale(
        request, state, auth_user=None, user_id=None
    )
    _start_turn_task(
        entry,
        _run_public_initial_turn(
            state,
            run_id=run_id,
            conversation_id=conversation_id,
            message=body.message,
            selected_skills=tuple(body.skills),
            explicit_planner=body.use_planner,
            idempotency_key=idem_key,
            turn_locale=turn_locale,
        ),
        idempotency_key=idem_key,
    )
    return _run_response(run)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=AgentRunResponse,
    responses={401: {"model": V1ErrorResponse}, 404: {"model": V1ErrorResponse}},
    status_code=202,
)
async def create_conversation_message(
    body: AgentMessageCreateRequest,
    request: Request,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> AgentRunResponse:
    idem_key = _idempotency_key(idempotency_header)
    request_fingerprint = _request_fingerprint(
        operation="message",
        body=body,
        conversation_id=conversation_id,
    )
    if idem_key is not None:
        async with state.db_session_factory() as session:
            existing = await state.db_repo.get_agent_run_by_idempotency(
                session,
                api_key_hash=auth.api_key_hash,
                idempotency_key=idem_key,
            )
        if existing is not None:
            _validate_idempotent_reuse(
                existing,
                operation="message",
                request_fingerprint=request_fingerprint,
            )
            return _run_response(existing)

    conv_uuid = uuid.UUID(conversation_id)
    if not await _conversation_allowed_for_api_key(
        state,
        conv_uuid,
        auth.api_key_hash,
    ):
        raise _public_error(404, "not_found", "Conversation not found.")

    entry = await _ensure_entry(state, conversation_id)
    run_id = uuid.uuid4()
    turn_locale = await _resolve_turn_locale(
        request, state, auth_user=None, user_id=None
    )
    async with entry.lock:
        current_turn = entry.turn_task
        if current_turn is not None and not current_turn.done():
            raise _public_error(
                409,
                "run_in_progress",
                "Conversation already has an active run.",
                {"conversation_id": conversation_id},
            )
        try:
            async with state.db_session_factory() as session:
                run = await state.db_repo.create_agent_run(
                    session,
                    run_id=run_id,
                    conversation_id=conv_uuid,
                    api_key_hash=auth.api_key_hash,
                    idempotency_key=idem_key,
                    status="queued",
                    config=_run_config(
                        operation="message",
                        body=body,
                        conversation_id=conversation_id,
                        request_fingerprint=request_fingerprint,
                    ),
                )
        except IntegrityError:
            if idem_key is None:
                raise
            async with state.db_session_factory() as session:
                existing = await state.db_repo.get_agent_run_by_idempotency(
                    session,
                    api_key_hash=auth.api_key_hash,
                    idempotency_key=idem_key,
                )
            if existing is None:
                raise
            _validate_idempotent_reuse(
                existing,
                operation="message",
                request_fingerprint=request_fingerprint,
            )
            return _run_response(existing)
        _start_turn_task(
            entry,
            _run_public_followup_turn(
                state,
                run_id=run_id,
                conversation_id=conversation_id,
                message=body.message,
                selected_skills=tuple(body.skills),
                explicit_planner=body.use_planner,
                idempotency_key=idem_key,
                turn_locale=turn_locale,
            ),
            idempotency_key=idem_key,
        )
    return _run_response(run)


@router.get(
    "/agent-runs/{run_id}",
    response_model=AgentRunResponse,
    responses={401: {"model": V1ErrorResponse}, 404: {"model": V1ErrorResponse}},
)
async def get_agent_run(
    run_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> AgentRunResponse:
    record = await state.db_repo.get_agent_run(
        session,
        uuid.UUID(run_id),
        api_key_hash=auth.api_key_hash,
    )
    if record is None:
        raise _public_error(404, "not_found", "Run not found.")
    return _run_response(record)


@router.get(
    "/agent-runs/{run_id}/result",
    response_model=None,
    responses={
        200: {
            "content": {
                "application/json": {},
                "text/plain": {},
                "text/markdown": {},
                "text/html": {},
            }
        },
        401: {"model": V1ErrorResponse},
        404: {"model": V1ErrorResponse},
        409: {"model": V1ErrorResponse},
    },
)
async def get_agent_run_result(
    run_id: str = Path(..., pattern=_UUID_PATTERN),
    result_format: Literal["json", "text", "markdown", "html"] = Query(
        default="json",
        alias="format",
    ),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
):
    record = await state.db_repo.get_agent_run(
        session,
        uuid.UUID(run_id),
        api_key_hash=auth.api_key_hash,
    )
    if record is None:
        raise _public_error(404, "not_found", "Run not found.")
    if record.status != "completed":
        raise _public_error(
            409,
            "run_not_complete",
            "Run result is not available until the run is completed.",
            {"status": record.status},
        )

    content = _completed_result_text(record)
    if result_format == "text":
        return PlainTextResponse(content, media_type="text/plain; charset=utf-8")
    if result_format == "markdown":
        return PlainTextResponse(content, media_type="text/markdown; charset=utf-8")
    if result_format == "html":
        return HTMLResponse(_html_result_document(record, content))
    artifact_ids = await _artifact_ids_for_run(state, record)
    return JSONResponse(
        AgentRunResultResponse(
            run_id=str(record.id),
            conversation_id=str(record.conversation_id),
            status="completed",
            content=content,
            format="text",
            artifact_ids=artifact_ids,
        ).model_dump()
    )


@router.get(
    "/agent-runs/{run_id}/events",
    responses={401: {"model": V1ErrorResponse}, 404: {"model": V1ErrorResponse}},
)
async def stream_agent_run_events(
    run_id: str = Path(..., pattern=_UUID_PATTERN),
    stream_format: Literal["sse", "ndjson"] = Query(default="sse", alias="format"),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> StreamingResponse:
    record = await state.db_repo.get_agent_run(
        session,
        uuid.UUID(run_id),
        api_key_hash=auth.api_key_hash,
    )
    if record is None:
        raise _public_error(404, "not_found", "Run not found.")
    media_type = (
        "application/x-ndjson" if stream_format == "ndjson" else "text/event-stream"
    )
    return StreamingResponse(
        _public_event_generator(state, record, stream_format=stream_format),
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/agent-runs/{run_id}/cancel",
    responses={
        200: {"content": {"application/json": {}}},
        401: {"model": V1ErrorResponse},
        404: {"model": V1ErrorResponse},
    },
)
async def cancel_agent_run(
    run_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> dict[str, str]:
    record = await state.db_repo.get_agent_run(
        session,
        uuid.UUID(run_id),
        api_key_hash=auth.api_key_hash,
    )
    if record is None:
        raise _public_error(404, "not_found", "Run not found.")
    if record.status in _TERMINAL_STATUSES:
        return {"status": "already_terminal"}

    conversation_id = str(record.conversation_id)
    entry = state.conversations.get(conversation_id)
    if entry is None:
        await _mark_run_cancelled(state, record.id)
        return {"status": "no_active_run"}

    async with entry.lock:
        turn_task = entry.turn_task
        if turn_task is None or turn_task.done():
            await _mark_run_cancelled(state, record.id)
            return {"status": "no_active_run"}

        orchestrator = entry.orchestrator
        if orchestrator is not None and hasattr(orchestrator, "cancel"):
            orchestrator.cancel()  # type: ignore[union-attr]

    async def _force_cancel_after_timeout() -> None:
        try:
            await asyncio.wait_for(asyncio.shield(turn_task), timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            turn_task.cancel()
            try:
                await turn_task
            except (asyncio.CancelledError, Exception):
                pass
        latest = await _latest_run_record(
            state,
            record.id,
            api_key_hash=auth.api_key_hash,
        )
        if latest is not None and latest.status not in _TERMINAL_STATUSES:
            await _mark_run_cancelled(state, record.id)

    asyncio.create_task(_force_cancel_after_timeout())
    return {"status": "cancelling"}


def _artifact_response(record: Any) -> ArtifactResponse:
    return ArtifactResponse(
        id=record.id,
        name=record.original_name,
        original_name=record.original_name,
        content_type=record.content_type,
        size=record.size,
        file_path=record.file_path,
        created_at=record.created_at,
    )


@router.get(
    "/conversations/{conversation_id}/artifacts",
    response_model=ArtifactListResponse,
    responses={401: {"model": V1ErrorResponse}, 404: {"model": V1ErrorResponse}},
)
async def list_conversation_artifacts(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> ArtifactListResponse:
    conv_uuid = uuid.UUID(conversation_id)
    if not await _conversation_allowed_for_api_key(
        state,
        conv_uuid,
        auth.api_key_hash,
    ):
        raise _public_error(404, "not_found", "Conversation not found.")
    records = await state.db_repo.list_artifacts(session, conv_uuid)
    return ArtifactListResponse(
        artifacts=[_artifact_response(record) for record in records],
    )


@router.get(
    "/conversations/{conversation_id}/artifacts/{artifact_id}",
    response_model=None,
    responses={401: {"model": V1ErrorResponse}, 404: {"model": V1ErrorResponse}},
)
async def get_conversation_artifact(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    artifact_id: str = Path(..., pattern=r"^[0-9a-f]{32}$"),
    inline: bool = False,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> FileResponse | RedirectResponse:
    conv_uuid = uuid.UUID(conversation_id)
    if not await _conversation_allowed_for_api_key(
        state,
        conv_uuid,
        auth.api_key_hash,
    ):
        raise _public_error(404, "not_found", "Conversation not found.")
    record = await state.db_repo.get_artifact(session, artifact_id)
    if record is None or record.conversation_id != conv_uuid:
        raise _public_error(404, "not_found", "Artifact not found.")

    if isinstance(state.storage_backend, LocalStorageBackend):
        file_path = await state.storage_backend.get_url(
            record.storage_key,
            record.content_type,
            record.original_name,
        )
        if not os.path.isfile(file_path):
            raise _public_error(404, "not_found", "Artifact file not found.")
        return FileResponse(
            path=file_path,
            media_type=record.content_type,
            filename=None if inline else record.original_name,
        )

    url = await state.storage_backend.get_url(
        record.storage_key,
        record.content_type,
        record.original_name,
    )
    return RedirectResponse(url=url, status_code=307)


@router.post(
    "/conversations/{conversation_id}/responses",
    responses={
        200: {"content": {"application/json": {}}},
        401: {"model": V1ErrorResponse},
        404: {"model": V1ErrorResponse},
        409: {"model": V1ErrorResponse},
    },
)
async def respond_to_prompt(
    body: UserInputRequest,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    state: AppState = Depends(get_app_state),
    auth: IntegrationAuth = Depends(require_v1_rate_limit),
) -> dict[str, str]:
    conv_uuid = uuid.UUID(conversation_id)
    if not await _conversation_allowed_for_api_key(
        state,
        conv_uuid,
        auth.api_key_hash,
    ):
        raise _public_error(404, "not_found", "Conversation not found.")
    coordinator = state.response_coordinator
    if coordinator is None:
        raise _public_error(
            503,
            "response_coordinator_unavailable",
            "Response coordinator unavailable.",
        )

    result = await coordinator.submit_response(
        conversation_id=conversation_id,
        request_id=body.request_id,
        response=body.response,
    )
    if result.status == SubmitResponseStatus.ALREADY_RESPONDED:
        raise _public_error(
            409,
            "already_responded",
            "Prompt response was already submitted.",
            {"request_id": body.request_id},
        )
    if result.status == SubmitResponseStatus.NOT_FOUND:
        raise _public_error(
            404,
            "not_found",
            "Prompt response request not found.",
            {"request_id": body.request_id},
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
