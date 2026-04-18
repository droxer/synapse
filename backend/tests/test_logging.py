from __future__ import annotations

from agent.logging import (
    _inject_conversation_context,
    conversation_log_context,
)


def test_inject_conversation_context_without_binding() -> None:
    record = {"extra": {}}

    _inject_conversation_context(record)

    assert record["extra"]["conversation_id"] == "-"


def test_inject_conversation_context_uses_bound_conversation_id() -> None:
    record = {"extra": {}}

    with conversation_log_context("conv-123"):
        _inject_conversation_context(record)

    assert record["extra"]["conversation_id"] == "conv-123"


def test_conversation_log_context_resets_after_exit() -> None:
    inside = {"extra": {}}
    after = {"extra": {}}

    with conversation_log_context("conv-456"):
        _inject_conversation_context(inside)

    _inject_conversation_context(after)

    assert inside["extra"]["conversation_id"] == "conv-456"
    assert after["extra"]["conversation_id"] == "-"
