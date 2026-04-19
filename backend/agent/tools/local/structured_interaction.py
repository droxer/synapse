"""Structured human-in-the-loop interaction tools."""

from __future__ import annotations

import json
from typing import Any

from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from api.events import EventType


def _normalize_options(raw: Any) -> list[dict[str, str]]:
    """Return sanitized prompt options."""
    if not isinstance(raw, list):
        return []

    options: list[dict[str, str]] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "")).strip()
        if not label:
            continue
        value = str(item.get("value", label)).strip() or label
        description = str(item.get("description", "")).strip()
        options.append(
            {
                "id": str(item.get("id", f"option_{idx + 1}")).strip()
                or f"option_{idx + 1}",
                "label": label,
                "value": value,
                "description": description,
            }
        )
    return options


def _match_option(
    response: str,
    options: list[dict[str, str]],
) -> dict[str, str] | None:
    normalized = response.strip().lower()
    if not normalized:
        return None
    for option in options:
        if normalized in {
            option["label"].strip().lower(),
            option["value"].strip().lower(),
            option["id"].strip().lower(),
        }:
            return option
    return None


class RequestUserInput(LocalTool):
    """Ask the user a structured question and wait for a response."""

    def __init__(self, event_emitter: Any) -> None:
        if event_emitter is None:
            raise ValueError("EventEmitter must not be None")
        self._emitter = event_emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="request_user_input",
            title="Request User Input",
            description=(
                "Ask the user a structured question. Supports multiple-choice "
                "options and optional freeform fallback. Returns a JSON payload "
                "describing the user's response."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "Question to present to the user.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short prompt title shown above the question.",
                    },
                    "options": {
                        "type": "array",
                        "description": "Optional structured answer choices.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "value": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["label"],
                        },
                    },
                    "allow_freeform": {
                        "type": "boolean",
                        "description": "Allow the user to type a custom response.",
                        "default": True,
                    },
                },
                "required": ["question"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "response": {"type": "string"},
                    "selected_option_id": {"type": ["string", "null"]},
                    "selected_label": {"type": ["string", "null"]},
                    "selected_value": {"type": ["string", "null"]},
                },
                "required": ["response"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={
                "readOnlyHint": True,
                "idempotentHint": False,
                "approvalRequired": False,
            },
            tags=("communication", "structured_input"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        question = str(kwargs.get("question", "")).strip()
        title = str(kwargs.get("title", "")).strip() or None
        options = _normalize_options(kwargs.get("options", []))
        allow_freeform = bool(kwargs.get("allow_freeform", True))

        if not question:
            return ToolResult.fail("question must not be empty")
        if options and not allow_freeform:
            title = title or "Choose an option"

        try:
            response = await self._emitter.emit_and_wait(
                EventType.ASK_USER,
                {
                    "question": question,
                    "title": title,
                    "prompt_kind": "structured_input",
                    "options": options,
                    "prompt_metadata": {"allow_freeform": allow_freeform},
                },
            )
        except Exception as exc:
            return ToolResult.fail(f"Failed to get user response: {exc}")

        matched = _match_option(response, options)
        payload = {
            "response": response,
            "selected_option_id": matched["id"] if matched else None,
            "selected_label": matched["label"] if matched else None,
            "selected_value": matched["value"] if matched else None,
        }
        return ToolResult.ok(
            json.dumps(payload, ensure_ascii=False),
            metadata=payload,
        )


class RequestApproval(LocalTool):
    """Request explicit approval for a risky or irreversible action."""

    def __init__(self, event_emitter: Any) -> None:
        if event_emitter is None:
            raise ValueError("EventEmitter must not be None")
        self._emitter = event_emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="request_approval",
            title="Request Approval",
            description=(
                "Ask the user to approve or deny a risky action. Returns a "
                "JSON payload with an `approved` boolean."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "Approval request shown to the user.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short title for the approval prompt.",
                        "default": "Approval required",
                    },
                    "action": {
                        "type": "string",
                        "description": "Short description of the action needing approval.",
                    },
                    "risk": {
                        "type": "string",
                        "description": "Why the action needs explicit confirmation.",
                    },
                    "approve_label": {
                        "type": "string",
                        "default": "Approve",
                    },
                    "deny_label": {
                        "type": "string",
                        "default": "Deny",
                    },
                },
                "required": ["question"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "response": {"type": "string"},
                    "approved": {"type": "boolean"},
                },
                "required": ["response", "approved"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={
                "readOnlyHint": True,
                "approvalRequired": False,
            },
            tags=("communication", "approval"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        question = str(kwargs.get("question", "")).strip()
        title = str(kwargs.get("title", "")).strip() or "Approval required"
        action = str(kwargs.get("action", "")).strip()
        risk = str(kwargs.get("risk", "")).strip()
        approve_label = str(kwargs.get("approve_label", "")).strip() or "Approve"
        deny_label = str(kwargs.get("deny_label", "")).strip() or "Deny"

        if not question:
            return ToolResult.fail("question must not be empty")

        options = [
            {"id": "approve", "label": approve_label, "value": "approve"},
            {"id": "deny", "label": deny_label, "value": "deny"},
        ]

        try:
            response = await self._emitter.emit_and_wait(
                EventType.ASK_USER,
                {
                    "question": question,
                    "title": title,
                    "prompt_kind": "approval",
                    "options": options,
                    "prompt_metadata": {
                        "allow_freeform": False,
                        "action": action,
                        "risk": risk,
                    },
                },
            )
        except Exception as exc:
            return ToolResult.fail(f"Failed to get approval: {exc}")

        matched = _match_option(response, options)
        approved = matched is not None and matched["id"] == "approve"
        payload = {"response": response, "approved": approved}
        return ToolResult.ok(
            json.dumps(payload, ensure_ascii=False),
            metadata=payload,
        )


class ConfirmAction(LocalTool):
    """Ask the user to confirm or cancel an action."""

    def __init__(self, event_emitter: Any) -> None:
        if event_emitter is None:
            raise ValueError("EventEmitter must not be None")
        self._emitter = event_emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="confirm_action",
            title="Confirm Action",
            description=(
                "Ask the user to confirm or cancel an action. Returns a JSON "
                "payload with a `confirmed` boolean."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "Confirmation request shown to the user.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Prompt title.",
                        "default": "Please confirm",
                    },
                    "confirm_label": {
                        "type": "string",
                        "default": "Confirm",
                    },
                    "cancel_label": {
                        "type": "string",
                        "default": "Cancel",
                    },
                },
                "required": ["question"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "response": {"type": "string"},
                    "confirmed": {"type": "boolean"},
                },
                "required": ["response", "confirmed"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True},
            tags=("communication", "confirmation"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        question = str(kwargs.get("question", "")).strip()
        title = str(kwargs.get("title", "")).strip() or "Please confirm"
        confirm_label = str(kwargs.get("confirm_label", "")).strip() or "Confirm"
        cancel_label = str(kwargs.get("cancel_label", "")).strip() or "Cancel"

        if not question:
            return ToolResult.fail("question must not be empty")

        options = [
            {"id": "confirm", "label": confirm_label, "value": "confirm"},
            {"id": "cancel", "label": cancel_label, "value": "cancel"},
        ]

        try:
            response = await self._emitter.emit_and_wait(
                EventType.ASK_USER,
                {
                    "question": question,
                    "title": title,
                    "prompt_kind": "confirmation",
                    "options": options,
                    "prompt_metadata": {"allow_freeform": False},
                },
            )
        except Exception as exc:
            return ToolResult.fail(f"Failed to confirm action: {exc}")

        matched = _match_option(response, options)
        confirmed = matched is not None and matched["id"] == "confirm"
        payload = {"response": response, "confirmed": confirmed}
        return ToolResult.ok(
            json.dumps(payload, ensure_ascii=False),
            metadata=payload,
        )
