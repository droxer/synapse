"""Tests for event emitter backpressure behavior."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from api.events import EventEmitter, EventType


@pytest.mark.asyncio
async def test_planner_events_are_not_dropped_under_backpressure() -> None:
    emitter = EventEmitter(max_pending=1)
    release = asyncio.Event()
    first_started = asyncio.Event()
    received: list[EventType] = []

    async def slow_subscriber(event: Any) -> None:
        received.append(event.type)
        if event.type == EventType.TEXT_DELTA and len(received) == 1:
            first_started.set()
        await release.wait()

    emitter.subscribe(slow_subscriber)

    first_emit = asyncio.create_task(
        emitter.emit(EventType.TEXT_DELTA, {"delta": "first"})
    )
    await first_started.wait()

    plan_emit = asyncio.create_task(emitter.emit(EventType.PLAN_CREATED, {"steps": []}))
    await emitter.emit(EventType.TEXT_DELTA, {"delta": "dropped"})

    release.set()
    await asyncio.gather(first_emit, plan_emit)

    assert received.count(EventType.TEXT_DELTA) == 1
    assert EventType.PLAN_CREATED in received
