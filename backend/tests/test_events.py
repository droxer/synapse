"""Tests for event emitter backpressure behavior."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from api.events import EventEmitter, EventType
from api.sse import _create_queue_subscriber


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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        (
            EventType.LLM_RESPONSE,
            {"text": "Final answer", "stop_reason": "end_turn"},
        ),
        (
            EventType.MESSAGE_USER,
            {"message": "Final answer"},
        ),
    ],
)
async def test_final_assistant_events_are_not_dropped_under_backpressure(
    event_type: EventType,
    payload: dict[str, Any],
) -> None:
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
        emitter.emit(EventType.TEXT_DELTA, {"delta": "partial"})
    )
    await first_started.wait()

    final_emit = asyncio.create_task(emitter.emit(event_type, payload))
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(first_emit, final_emit)

    assert received == [EventType.TEXT_DELTA, event_type]


@pytest.mark.asyncio
async def test_sse_queue_preserves_structural_events_when_full() -> None:
    queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=1)
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(queue, pending_callbacks)

    await queue.put(object())

    consumer_started = asyncio.Event()

    async def drain_queue() -> None:
        consumer_started.set()
        await asyncio.sleep(0)
        await queue.get()
        queue.task_done()

    consumer = asyncio.create_task(drain_queue())
    await subscriber(
        type(
            "Evt",
            (),
            {
                "type": EventType.TOOL_CALL,
                "data": {},
                "timestamp": 0,
                "iteration": None,
            },
        )()
    )
    await consumer_started.wait()
    await consumer

    structural = await asyncio.wait_for(queue.get(), timeout=1)
    assert structural.type == EventType.TOOL_CALL


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        (
            EventType.LLM_RESPONSE,
            {"text": "Final answer", "stop_reason": "end_turn"},
        ),
        (
            EventType.MESSAGE_USER,
            {"message": "Final answer"},
        ),
    ],
)
async def test_sse_queue_preserves_final_assistant_events_when_full(
    event_type: EventType,
    payload: dict[str, Any],
) -> None:
    queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=1)
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(queue, pending_callbacks)

    await queue.put(object())

    consumer_started = asyncio.Event()

    async def drain_queue() -> None:
        consumer_started.set()
        await asyncio.sleep(0)
        await queue.get()
        queue.task_done()

    consumer = asyncio.create_task(drain_queue())
    await subscriber(
        type(
            "Evt",
            (),
            {
                "type": event_type,
                "data": payload,
                "timestamp": 0,
                "iteration": None,
            },
        )()
    )
    await consumer_started.wait()
    await consumer

    preserved = await asyncio.wait_for(queue.get(), timeout=1)
    assert preserved.type == event_type
    assert preserved.data == payload


@pytest.mark.asyncio
async def test_sse_queue_drops_text_delta_when_full() -> None:
    queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=1)
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(queue, pending_callbacks)

    sentinel = object()
    await queue.put(sentinel)

    await subscriber(
        type(
            "Evt",
            (),
            {
                "type": EventType.TEXT_DELTA,
                "data": {"delta": "hello"},
                "timestamp": 0,
                "iteration": None,
            },
        )()
    )

    assert queue.qsize() == 1
    assert queue.get_nowait() is sentinel


@pytest.mark.asyncio
async def test_sse_queue_can_drop_text_delta_without_losing_final_assistant_payload() -> (
    None
):
    queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=1)
    pending_callbacks: dict[str, Any] = {}
    subscriber = _create_queue_subscriber(queue, pending_callbacks)

    sentinel = object()
    await queue.put(sentinel)

    await subscriber(
        type(
            "Evt",
            (),
            {
                "type": EventType.TEXT_DELTA,
                "data": {"delta": "partial"},
                "timestamp": 0,
                "iteration": None,
            },
        )()
    )

    assert queue.get_nowait() is sentinel

    await subscriber(
        type(
            "Evt",
            (),
            {
                "type": EventType.MESSAGE_USER,
                "data": {"message": "Final answer"},
                "timestamp": 1,
                "iteration": None,
            },
        )()
    )

    preserved = queue.get_nowait()
    assert preserved.type == EventType.MESSAGE_USER
    assert preserved.data == {"message": "Final answer"}
