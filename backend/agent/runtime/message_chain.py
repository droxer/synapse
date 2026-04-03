"""Lightweight checks for Anthropic-style message sequences."""

from __future__ import annotations

import json
from typing import Any


def collect_message_chain_warnings(
    messages: tuple[dict[str, Any], ...],
) -> list[str]:
    """Return human-readable warnings for common assistant/tool ordering issues."""
    warnings: list[str] = []
    pending_tool_ids: set[str] = set()

    for idx, msg in enumerate(messages):
        role = msg.get("role")
        content = msg.get("content")

        if role == "assistant" and isinstance(content, list):
            new_ids: set[str] = set()
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use" and block.get("id"):
                    new_ids.add(str(block["id"]))
            if new_ids:
                if pending_tool_ids:
                    warnings.append(
                        f"message[{idx}]: new assistant tool_use before prior "
                        "tool_result round completed"
                    )
                pending_tool_ids = new_ids

        elif role == "user":
            if not pending_tool_ids:
                continue
            if not isinstance(content, list):
                warnings.append(
                    f"message[{idx}]: expected tool_result list after tool_use; "
                    "got non-list user content"
                )
                pending_tool_ids.clear()
                continue
            resolved: set[str] = set()
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_result":
                    tid = block.get("tool_use_id")
                    if tid:
                        resolved.add(str(tid))
            missing = pending_tool_ids - resolved
            if missing:
                warnings.append(
                    f"message[{idx}]: tool_result missing for tool_use id(s): "
                    f"{sorted(missing)[:8]}" + ("…" if len(missing) > 8 else "")
                )
            pending_tool_ids.clear()

    if pending_tool_ids:
        warnings.append(
            "end_of_chain: tool_use block(s) without following tool_result: "
            f"{sorted(pending_tool_ids)[:8]}"
            + ("…" if len(pending_tool_ids) > 8 else "")
        )

    return warnings


def tool_calls_fingerprint(tool_calls: tuple[Any, ...]) -> str:
    """Stable signature for a batch of tool calls (for stuck-loop detection)."""
    parts: list[str] = []
    for tc in tool_calls:
        try:
            payload = json.dumps(tc.input, sort_keys=True, default=str)
        except TypeError:
            payload = str(tc.input)
        parts.append(f"{tc.name}:{payload}")
    return "|".join(parts)
