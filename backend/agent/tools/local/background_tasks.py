"""Local background task manager and tools."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from api.events import EventType


@dataclass
class ScheduledTask:
    """Runtime-only background task state."""

    task_id: str
    title: str
    message: str
    delay_seconds: float
    created_at: float
    scheduled_for: float
    status: str = "scheduled"
    result: str | None = None
    error: str | None = None
    completed_at: float | None = None
    asyncio_task: asyncio.Task[None] | None = None


class BackgroundTaskManager:
    """Manages delayed notification tasks for a conversation runtime."""

    def __init__(self, event_emitter: Any) -> None:
        self._emitter = event_emitter
        self._tasks: dict[str, ScheduledTask] = {}

    async def schedule_notification(
        self,
        *,
        title: str,
        message: str,
        delay_seconds: float,
    ) -> ScheduledTask:
        task_id = f"bg_{uuid4().hex[:12]}"
        now = time.time()
        record = ScheduledTask(
            task_id=task_id,
            title=title,
            message=message,
            delay_seconds=delay_seconds,
            created_at=now,
            scheduled_for=now + delay_seconds,
        )
        record.asyncio_task = asyncio.create_task(self._run_notification(record))
        self._tasks[task_id] = record
        return record

    def get(self, task_id: str) -> ScheduledTask | None:
        return self._tasks.get(task_id)

    async def cancel(self, task_id: str) -> ScheduledTask | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        task = record.asyncio_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if record.status not in {"completed", "failed"}:
            record.status = "cancelled"
            record.completed_at = time.time()
            record.result = "Cancelled before execution."
        return record

    def snapshot(self, task_id: str) -> dict[str, Any] | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        return {
            "task_id": record.task_id,
            "title": record.title,
            "message": record.message,
            "delay_seconds": record.delay_seconds,
            "created_at": record.created_at,
            "scheduled_for": record.scheduled_for,
            "status": record.status,
            "result": record.result,
            "error": record.error,
            "completed_at": record.completed_at,
        }

    async def replay(self, task_id: str) -> dict[str, Any] | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        if record.status == "completed" and record.result:
            await self._emitter.emit(
                EventType.MESSAGE_USER,
                {
                    "message": record.message,
                    "title": record.title,
                    "background_task_id": task_id,
                },
            )
        return self.snapshot(task_id)

    async def _run_notification(self, record: ScheduledTask) -> None:
        try:
            if record.delay_seconds > 0:
                await asyncio.sleep(record.delay_seconds)
            record.status = "running"
            await self._emitter.emit(
                EventType.MESSAGE_USER,
                {
                    "message": record.message,
                    "title": record.title,
                    "background_task_id": record.task_id,
                },
            )
            record.status = "completed"
            record.result = "Notification delivered."
            record.completed_at = time.time()
        except asyncio.CancelledError:
            record.status = "cancelled"
            record.result = "Cancelled before execution."
            record.completed_at = time.time()
            raise
        except Exception as exc:
            record.status = "failed"
            record.error = str(exc)
            record.completed_at = time.time()


class TaskSchedule(LocalTool):
    """Schedule a delayed background notification."""

    def __init__(self, manager: BackgroundTaskManager) -> None:
        self._manager = manager

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="task_schedule",
            title="Schedule Task",
            description=(
                "Schedule a background notification to be sent to the user later. "
                "Returns a task_id for task_watch, task_resume, and task_cancel."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Short task title.",
                        "default": "Scheduled task",
                    },
                    "message": {
                        "type": "string",
                        "description": "Message to deliver when the task fires.",
                    },
                    "delay_seconds": {
                        "type": "number",
                        "description": "How long to wait before delivering the message.",
                        "default": 60,
                    },
                },
                "required": ["message"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "status": {"type": "string"},
                },
                "required": ["task_id", "status"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"longRunningHint": True},
            tags=("background", "notification"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        title = str(kwargs.get("title", "")).strip() or "Scheduled task"
        message = str(kwargs.get("message", "")).strip()
        delay_seconds = float(kwargs.get("delay_seconds", 60))

        if not message:
            return ToolResult.fail("message must not be empty")
        if delay_seconds < 0:
            return ToolResult.fail("delay_seconds must be >= 0")

        record = await self._manager.schedule_notification(
            title=title,
            message=message,
            delay_seconds=delay_seconds,
        )
        payload = {"task_id": record.task_id, "status": record.status}
        return ToolResult.ok(
            json.dumps(payload, ensure_ascii=False),
            metadata=payload,
        )


class TaskWatch(LocalTool):
    """Inspect the state of a scheduled background task."""

    def __init__(self, manager: BackgroundTaskManager) -> None:
        self._manager = manager

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="task_watch",
            title="Watch Task",
            description="Inspect the latest status of a scheduled background task.",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task ID returned by task_schedule.",
                    }
                },
                "required": ["task_id"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True, "longRunningHint": True},
            tags=("background",),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task_id = str(kwargs.get("task_id", "")).strip()
        if not task_id:
            return ToolResult.fail("task_id must not be empty")
        snapshot = self._manager.snapshot(task_id)
        if snapshot is None:
            return ToolResult.fail(f"Unknown background task: {task_id}")
        return ToolResult.ok(
            json.dumps(snapshot, ensure_ascii=False), metadata=snapshot
        )


class TaskResume(LocalTool):
    """Replay or inspect the result of a background task."""

    def __init__(self, manager: BackgroundTaskManager) -> None:
        self._manager = manager

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="task_resume",
            title="Resume Task",
            description=(
                "Resume the context of a background task by replaying its result to "
                "the user, or by returning its latest snapshot."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task ID returned by task_schedule.",
                    },
                    "replay_to_user": {
                        "type": "boolean",
                        "description": "Re-send the task result to the user if available.",
                        "default": True,
                    },
                },
                "required": ["task_id"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"longRunningHint": True},
            tags=("background",),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task_id = str(kwargs.get("task_id", "")).strip()
        replay_to_user = bool(kwargs.get("replay_to_user", True))
        if not task_id:
            return ToolResult.fail("task_id must not be empty")

        if replay_to_user:
            snapshot = await self._manager.replay(task_id)
        else:
            snapshot = self._manager.snapshot(task_id)
        if snapshot is None:
            return ToolResult.fail(f"Unknown background task: {task_id}")

        return ToolResult.ok(
            json.dumps(snapshot, ensure_ascii=False), metadata=snapshot
        )


class TaskCancel(LocalTool):
    """Cancel a pending background task."""

    def __init__(self, manager: BackgroundTaskManager) -> None:
        self._manager = manager

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="task_cancel",
            title="Cancel Task",
            description="Cancel a scheduled background task before it completes.",
            input_schema={
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task ID returned by task_schedule.",
                    }
                },
                "required": ["task_id"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"destructiveHint": True, "approvalRequired": False},
            tags=("background",),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task_id = str(kwargs.get("task_id", "")).strip()
        if not task_id:
            return ToolResult.fail("task_id must not be empty")
        record = await self._manager.cancel(task_id)
        if record is None:
            return ToolResult.fail(f"Unknown background task: {task_id}")
        snapshot = self._manager.snapshot(task_id) or {"task_id": task_id}
        return ToolResult.ok(
            json.dumps(snapshot, ensure_ascii=False), metadata=snapshot
        )


class NotifyUser(LocalTool):
    """Explicit notification tool for immediate user-facing messages."""

    def __init__(self, event_emitter: Any) -> None:
        self._emitter = event_emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="notify_user",
            title="Notify User",
            description="Send a notification-style message to the user immediately.",
            input_schema={
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Notification text to show to the user.",
                    }
                },
                "required": ["message"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True},
            tags=("communication", "notification"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        message = str(kwargs.get("message", "")).strip()
        if not message:
            return ToolResult.fail("message must not be empty")
        await self._emitter.emit(EventType.MESSAGE_USER, {"message": message})
        return ToolResult.ok("Notification sent.")
