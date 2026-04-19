from __future__ import annotations

import json
from typing import Any

import pytest

from agent.tools.local.structured_interaction import (
    ConfirmAction,
    RequestApproval,
    RequestUserInput,
)
from api.events import EventType


class _FakeEmitter:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls: list[tuple[EventType, dict[str, Any]]] = []

    async def emit_and_wait(
        self,
        event_type: EventType,
        data: dict[str, Any],
    ) -> str:
        self.calls.append((event_type, data))
        return self.response


@pytest.mark.asyncio
async def test_request_user_input_returns_selected_option_metadata() -> None:
    emitter = _FakeEmitter("fast")
    tool = RequestUserInput(emitter)

    result = await tool.execute(
        question="Which mode should I use?",
        title="Execution mode",
        options=[
            {"id": "fast_mode", "label": "Fast", "value": "fast"},
            {"id": "deep_mode", "label": "Deep", "value": "deep"},
        ],
        allow_freeform=False,
    )

    assert result.success
    payload = json.loads(result.output)
    assert payload == {
        "response": "fast",
        "selected_option_id": "fast_mode",
        "selected_label": "Fast",
        "selected_value": "fast",
    }

    [(event_type, data)] = emitter.calls
    assert event_type == EventType.ASK_USER
    assert data["prompt_kind"] == "structured_input"
    assert data["title"] == "Execution mode"
    assert data["prompt_metadata"] == {"allow_freeform": False}


@pytest.mark.asyncio
async def test_request_approval_returns_approved_true_for_approve_label() -> None:
    emitter = _FakeEmitter("Approve")
    tool = RequestApproval(emitter)

    result = await tool.execute(
        question="Deploy the latest draft?",
        action="Deploy draft",
        risk="This will update the live preview.",
    )

    assert result.success
    payload = json.loads(result.output)
    assert payload == {"response": "Approve", "approved": True}

    [(event_type, data)] = emitter.calls
    assert event_type == EventType.ASK_USER
    assert data["prompt_kind"] == "approval"
    assert data["options"][0]["id"] == "approve"
    assert data["prompt_metadata"] == {
        "allow_freeform": False,
        "action": "Deploy draft",
        "risk": "This will update the live preview.",
    }


@pytest.mark.asyncio
async def test_confirm_action_returns_confirmed_false_for_cancel() -> None:
    emitter = _FakeEmitter("Cancel")
    tool = ConfirmAction(emitter)

    result = await tool.execute(question="Submit the purchase order?")

    assert result.success
    payload = json.loads(result.output)
    assert payload == {"response": "Cancel", "confirmed": False}

    [(event_type, data)] = emitter.calls
    assert event_type == EventType.ASK_USER
    assert data["prompt_kind"] == "confirmation"
    assert data["prompt_metadata"] == {"allow_freeform": False}
