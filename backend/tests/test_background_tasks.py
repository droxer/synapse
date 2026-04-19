from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from agent.tools.local.background_tasks import (
    BackgroundTaskManager,
    NotifyUser,
    TaskCancel,
    TaskResume,
    TaskSchedule,
    TaskWatch,
)
from api.events import EventType


class _RecordingEmitter:
    def __init__(self) -> None:
        self.events: list[tuple[EventType, dict[str, Any]]] = []

    async def emit(self, event_type: EventType, data: dict[str, Any]) -> None:
        self.events.append((event_type, data))


async def _wait_for_status(
    manager: BackgroundTaskManager,
    task_id: str,
    expected: str,
) -> dict[str, Any]:
    for _ in range(50):
        snapshot = manager.snapshot(task_id)
        if snapshot is not None and snapshot["status"] == expected:
            return snapshot
        await asyncio.sleep(0.01)
    raise AssertionError(f"Task {task_id} did not reach status {expected}")


@pytest.mark.asyncio
async def test_schedule_watch_and_resume_background_task() -> None:
    emitter = _RecordingEmitter()
    manager = BackgroundTaskManager(emitter)
    schedule = TaskSchedule(manager)
    watch = TaskWatch(manager)
    resume = TaskResume(manager)

    scheduled = await schedule.execute(
        title="Reminder",
        message="Check the uploaded report.",
        delay_seconds=0,
    )
    assert scheduled.success

    task_id = json.loads(scheduled.output)["task_id"]
    await _wait_for_status(manager, task_id, "completed")

    watched = await watch.execute(task_id=task_id)
    assert watched.success
    watched_payload = json.loads(watched.output)
    assert watched_payload["status"] == "completed"
    assert emitter.events == [
        (
            EventType.MESSAGE_USER,
            {
                "message": "Check the uploaded report.",
                "title": "Reminder",
                "background_task_id": task_id,
            },
        )
    ]

    resumed = await resume.execute(task_id=task_id, replay_to_user=True)
    assert resumed.success
    resumed_payload = json.loads(resumed.output)
    assert resumed_payload["status"] == "completed"
    assert len(emitter.events) == 2


@pytest.mark.asyncio
async def test_cancel_background_task_prevents_delivery() -> None:
    emitter = _RecordingEmitter()
    manager = BackgroundTaskManager(emitter)
    schedule = TaskSchedule(manager)
    cancel = TaskCancel(manager)

    scheduled = await schedule.execute(
        title="Later",
        message="Do not send this yet.",
        delay_seconds=60,
    )
    task_id = json.loads(scheduled.output)["task_id"]

    cancelled = await cancel.execute(task_id=task_id)
    assert cancelled.success
    payload = json.loads(cancelled.output)
    assert payload["status"] == "cancelled"
    assert emitter.events == []


@pytest.mark.asyncio
async def test_resume_cancelled_background_task_does_not_replay_message() -> None:
    emitter = _RecordingEmitter()
    manager = BackgroundTaskManager(emitter)
    schedule = TaskSchedule(manager)
    cancel = TaskCancel(manager)
    resume = TaskResume(manager)

    scheduled = await schedule.execute(
        title="Later",
        message="Do not replay this.",
        delay_seconds=60,
    )
    task_id = json.loads(scheduled.output)["task_id"]
    await cancel.execute(task_id=task_id)

    resumed = await resume.execute(task_id=task_id, replay_to_user=True)

    assert resumed.success
    assert json.loads(resumed.output)["status"] == "cancelled"
    assert emitter.events == []


@pytest.mark.asyncio
async def test_notify_user_emits_immediate_message() -> None:
    emitter = _RecordingEmitter()
    tool = NotifyUser(emitter)

    result = await tool.execute(message="Download complete.")

    assert result.success
    assert emitter.events == [
        (EventType.MESSAGE_USER, {"message": "Download complete."})
    ]
