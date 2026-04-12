"""Tests for AnthropicClient streaming callbacks."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from agent.llm.client import AnthropicClient


class _FakeStream:
    def __init__(
        self, events: list[SimpleNamespace], final_message: SimpleNamespace
    ) -> None:
        self._events = events
        self._final_message = final_message
        self._idx = 0

    def __aiter__(self) -> _FakeStream:
        return self

    async def __anext__(self) -> SimpleNamespace:
        if self._idx >= len(self._events):
            raise StopAsyncIteration
        event = self._events[self._idx]
        self._idx += 1
        return event

    async def get_final_message(self) -> SimpleNamespace:
        return self._final_message


class _FakeStreamContext:
    def __init__(self, stream: _FakeStream) -> None:
        self._stream = stream

    async def __aenter__(self) -> _FakeStream:
        return self._stream

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeMessagesAPI:
    def __init__(self, stream_ctx: _FakeStreamContext) -> None:
        self._stream_ctx = stream_ctx

    def stream(self, **kwargs) -> _FakeStreamContext:
        return self._stream_ctx


@pytest.mark.asyncio
async def test_stream_emits_thinking_before_first_text_delta() -> None:
    final_message = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="hello world")],
        stop_reason="end_turn",
        usage=SimpleNamespace(input_tokens=10, output_tokens=20),
    )
    stream = _FakeStream(
        events=[
            SimpleNamespace(type="thinking", snapshot="draft thinking"),
            SimpleNamespace(type="thinking", snapshot="final thinking"),
            SimpleNamespace(type="text", text="hello "),
            SimpleNamespace(type="text", text="world"),
        ],
        final_message=final_message,
    )
    client = AnthropicClient.__new__(AnthropicClient)
    client._default_model = "test-model"
    client._default_max_tokens = 1024
    client._client = SimpleNamespace(
        messages=_FakeMessagesAPI(_FakeStreamContext(stream))
    )

    callback_order: list[tuple[str, str]] = []

    async def on_thinking_ready(text: str) -> None:
        callback_order.append(("thinking", text))

    async def on_text_delta(delta: str) -> None:
        callback_order.append(("text", delta))

    await client.create_message_stream(
        system="you are helpful",
        messages=[{"role": "user", "content": "hi"}],
        on_text_delta=on_text_delta,
        on_thinking_ready=on_thinking_ready,
    )

    assert callback_order == [
        ("thinking", "final thinking"),
        ("text", "hello "),
        ("text", "world"),
    ]
