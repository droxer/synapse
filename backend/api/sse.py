"""SSE (Server-Sent Events) helpers for streaming agent events."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from loguru import logger

from api.events import AgentEvent, EventType
from api.models import ConversationEntry

_NON_LOSSY_SSE_EVENTS = {
    EventType.ASK_USER,
    EventType.USER_RESPONSE,
    EventType.LLM_RESPONSE,
    EventType.MESSAGE_USER,
    EventType.TURN_COMPLETE,
    EventType.TURN_CANCELLED,
    EventType.TASK_COMPLETE,
    EventType.TASK_ERROR,
    EventType.TOOL_CALL,
    EventType.TOOL_RESULT,
    EventType.AGENT_SPAWN,
    EventType.AGENT_COMPLETE,
    EventType.AGENT_HANDOFF,
    EventType.AGENT_STAGE_TRANSITION,
    EventType.AGENT_SKIPPED,
    EventType.AGENT_REPLAN_REQUIRED,
    EventType.PLAN_CREATED,
    EventType.PLANNER_AUTO_SELECTED,
}


def _create_queue_subscriber(
    queue: asyncio.Queue[AgentEvent | None],
    pending_callbacks: dict[str, Any],
) -> Any:
    """Create an async callback that pushes events into a queue."""

    def _make_room_for_non_lossy_event() -> bool:
        """Drop one lossy queued item so a structural live event can fit."""
        queued: list[AgentEvent | None] = []
        dropped = False
        for _ in range(queue.qsize()):
            try:
                queued_event = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            queued_type = getattr(queued_event, "type", None)
            if not dropped and queued_type not in _NON_LOSSY_SSE_EVENTS:
                dropped = True
                continue
            queued.append(queued_event)

        for queued_event in queued:
            try:
                queue.put_nowait(queued_event)
            except asyncio.QueueFull:
                break
        return dropped

    async def _subscriber(event: AgentEvent) -> None:
        callback = event.data.get("response_callback")
        if callback is not None:
            request_id = event.data.get("request_id") or f"req_{uuid.uuid4().hex[:12]}"
            event = AgentEvent(
                type=event.type,
                data={**event.data, "_request_id": request_id},
                timestamp=event.timestamp,
                iteration=event.iteration,
            )
            pending_callbacks[request_id] = callback
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            if event.type in _NON_LOSSY_SSE_EVENTS:
                if _make_room_for_non_lossy_event():
                    try:
                        queue.put_nowait(event)
                        return
                    except asyncio.QueueFull:
                        pass
                logger.warning(
                    "event_queue_full event_type={} — dropping non-lossy live event",
                    event.type,
                )
                return
            logger.warning(
                "event_queue_full event_type={} — dropping event", event.type
            )

    return _subscriber


async def _event_generator(
    conversation_id: str,
    entry: ConversationEntry,
) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted events. Connection stays open between turns.

    When the SSE client disconnects we only detach the queue subscriber —
    the conversation itself is kept alive so the client can reconnect and
    send follow-up messages.  Actual cleanup happens via the stale-
    conversation reaper or an explicit DELETE.
    """
    try:
        while True:
            # Wait for next event (blocks between turns — that's intentional)
            try:
                event = await asyncio.wait_for(entry.event_queue.get(), timeout=300.0)
            except asyncio.TimeoutError:
                # Send keepalive comment to prevent proxy/browser timeout
                yield ": keepalive\n\n"
                continue

            if event is None:
                # Explicit conversation end
                yield "event: done\ndata: {}\n\n"
                break

            payload = _serialize_event(event)
            if event.type == EventType.ASK_USER:
                logger.info("sse_sending_ask_user payload={}", payload[:200])
            yield f"event: {event.type.value}\ndata: {payload}\n\n"
    except (asyncio.CancelledError, GeneratorExit):
        logger.info("sse_client_disconnected conversation_id={}", conversation_id)


def _serialize_event(event: AgentEvent) -> str:
    """Serialize an AgentEvent to a JSON string."""
    serializable_data: dict[str, Any] = {}
    for k, v in event.data.items():
        if k == "_request_id":
            serializable_data["request_id"] = v
        elif callable(v):
            continue
        else:
            serializable_data[k] = v

    return json.dumps(
        {
            "event_type": event.type.value,
            "data": serializable_data,
            "timestamp": event.timestamp,
            "iteration": event.iteration,
        },
        default=str,
    )
