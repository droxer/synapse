"""Event system for real-time agent communication."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable, Coroutine


class EventType(StrEnum):
    """Types of events emitted during agent execution."""

    TASK_START = "task_start"
    TASK_COMPLETE = "task_complete"
    TASK_ERROR = "task_error"

    TURN_START = "turn_start"
    TURN_COMPLETE = "turn_complete"
    TURN_CANCELLED = "turn_cancelled"

    ITERATION_START = "iteration_start"
    ITERATION_COMPLETE = "iteration_complete"

    LLM_REQUEST = "llm_request"
    LLM_RESPONSE = "llm_response"
    TEXT_DELTA = "text_delta"

    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"

    MESSAGE_USER = "message_user"
    ASK_USER = "ask_user"
    USER_RESPONSE = "user_response"

    AGENT_SPAWN = "agent_spawn"
    AGENT_COMPLETE = "agent_complete"
    AGENT_HANDOFF = "agent_handoff"

    THINKING = "thinking"

    SANDBOX_STDOUT = "sandbox_stdout"
    SANDBOX_STDERR = "sandbox_stderr"
    CODE_RESULT = "code_result"

    ARTIFACT_CREATED = "artifact_created"

    CONVERSATION_TITLE = "conversation_title"

    PREVIEW_AVAILABLE = "preview_available"
    PREVIEW_STOPPED = "preview_stopped"

    SKILL_ACTIVATED = "skill_activated"

    PLAN_CREATED = "plan_created"

    CONTEXT_COMPACTED = "context_compacted"

    SKILL_DEPENDENCY_FAILED = "skill_dependency_failed"
    SKILL_SETUP_FAILED = "skill_setup_failed"
    LOOP_GUARD_NUDGE = "loop_guard_nudge"

    PLANNER_AUTO_SELECTED = "planner_auto_selected"


@dataclass(frozen=True)
class AgentEvent:
    """Immutable event emitted during agent execution."""

    type: EventType
    data: dict[str, Any]
    timestamp: float = field(default_factory=time.time)
    iteration: int | None = None


# Type alias for subscriber callbacks
SubscriberCallback = Callable[[AgentEvent], Coroutine[Any, Any, None]]


class EventEmitter:
    """Pub/sub event emitter for agent lifecycle events.

    Includes backpressure protection via max_pending limit to prevent
    unbounded memory growth when subscribers are slow.
    """

    def __init__(self, max_pending: int = 1000) -> None:
        self._subscribers: list[SubscriberCallback] = []
        self._max_pending = max_pending
        self._pending_count = 0

    def subscribe(self, callback: SubscriberCallback) -> None:
        """Register an async callback to receive all emitted events.

        Args:
            callback: An async function that accepts an AgentEvent.

        Raises:
            TypeError: If callback is not callable.
        """
        if not callable(callback):
            raise TypeError(f"Subscriber must be callable, got {type(callback)}")
        self._subscribers = [*self._subscribers, callback]

    def unsubscribe(self, callback: SubscriberCallback) -> None:
        """Remove a previously registered subscriber.

        Args:
            callback: The callback to remove.
        """
        self._subscribers = [s for s in self._subscribers if s is not callback]

    async def emit(
        self,
        event_type: EventType,
        data: dict[str, Any],
        iteration: int | None = None,
    ) -> None:
        """Create an AgentEvent and notify all subscribers.

        Args:
            event_type: The type of event being emitted.
            data: Arbitrary event payload.
            iteration: Optional iteration number for loop-related events.
        """
        from loguru import logger

        # Backpressure: drop events if too many pending
        if self._pending_count >= self._max_pending:
            logger.warning(
                "event_emitter_backpressure event_type={} pending={} — dropping event",
                event_type,
                self._pending_count,
            )
            return

        event = AgentEvent(
            type=event_type,
            data=data,
            iteration=iteration,
        )

        # Snapshot subscribers to avoid race conditions during iteration
        subscribers = self._subscribers
        self._pending_count += len(subscribers)

        try:
            results = await asyncio.gather(
                *[subscriber(event) for subscriber in subscribers],
                return_exceptions=True,
            )
        finally:
            self._pending_count = max(0, self._pending_count - len(subscribers))

        for subscriber, result in zip(subscribers, results):
            if isinstance(result, Exception):
                logger.error(
                    "Subscriber {} failed for event {}: {}",
                    subscriber,
                    event_type,
                    result,
                )

    async def emit_and_wait(
        self,
        event_type: EventType,
        data: dict[str, Any],
        timeout: float = 300.0,
    ) -> str:
        """Emit an event and block until a response is provided.

        The event data will include a ``response_callback`` that the
        subscriber must call with a string response to unblock the caller.

        Args:
            event_type: The type of event being emitted.
            data: Arbitrary event payload (a ``response_callback`` key is added).
            timeout: Maximum seconds to wait for a response (default 300).

        Returns:
            The response string provided via the callback.

        Raises:
            TimeoutError: If no response is received within the timeout.
        """
        ready = asyncio.Event()
        response_holder: list[str] = []

        def response_callback(response: str) -> None:
            response_holder.append(response)
            ready.set()

        request_id = f"req_{uuid.uuid4().hex[:12]}"
        enriched_data = {
            **data,
            "response_callback": response_callback,
            "request_id": request_id,
        }

        await self.emit(event_type, enriched_data)

        try:
            await asyncio.wait_for(ready.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(
                f"No response received for event {event_type} within {timeout}s"
            ) from None

        if not response_holder:
            raise RuntimeError(
                f"Event {event_type} was signalled but no response was provided"
            )

        return response_holder[0]
