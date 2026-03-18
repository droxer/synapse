"""Context compaction observer for the agent loop.

Manages message history size by summarizing older tool interactions
while preserving the original task and recent context. All operations
return new tuples — input messages are never mutated.
"""

from __future__ import annotations

from typing import Any

_TRUNCATED_TEMPLATE = "[tool_result truncated: {preview}...]"
_SCREENSHOT_PLACEHOLDER = "[screenshot captured]"
_PREVIEW_LENGTH = 100


class Observer:
    """Monitors and compacts agent message history.

    Keeps the original user task and recent interactions in full,
    while summarizing older tool outputs to reduce context size.
    """

    def __init__(self, max_full_interactions: int = 5) -> None:
        if max_full_interactions < 1:
            raise ValueError("max_full_interactions must be >= 1")
        self._max_full_interactions = max_full_interactions

    def should_compact(
        self,
        messages: tuple[dict[str, Any], ...],
        threshold: int = 50,
    ) -> bool:
        """Return True if the message count exceeds *threshold*."""
        return len(messages) > threshold

    def compact(
        self,
        messages: tuple[dict[str, Any], ...],
    ) -> tuple[dict[str, Any], ...]:
        """Return a compacted copy of *messages*.

        Strategy:
        - The first user message (original task) is kept verbatim.
        - The last ``max_full_interactions`` tool interaction pairs
          are kept in full.
        - Older tool results are truncated to a short preview.
        - Screenshot references are replaced with a placeholder.
        """
        if len(messages) <= 1:
            return messages

        first_message = messages[0]
        remaining = messages[1:]

        # Identify the boundary: keep last N interactions in full
        interaction_indices = _find_tool_interaction_indices(remaining)
        keep_full_from = _compute_full_boundary(
            interaction_indices,
            self._max_full_interactions,
        )

        compacted_remaining = tuple(
            _compact_message(msg, idx, keep_full_from)
            for idx, msg in enumerate(remaining)
        )

        return (first_message, *compacted_remaining)


# ---------------------------------------------------------------------------
# Pure helper functions
# ---------------------------------------------------------------------------


def _find_tool_interaction_indices(
    messages: tuple[dict[str, Any], ...] | list[dict[str, Any]],
) -> tuple[int, ...]:
    """Return indices of messages that contain tool results."""
    return tuple(idx for idx, msg in enumerate(messages) if _has_tool_results(msg))


def _compute_full_boundary(
    interaction_indices: tuple[int, ...],
    max_full: int,
) -> int:
    """Return the index from which messages should be kept in full.

    Messages at or after this index are preserved verbatim.
    """
    if not interaction_indices or len(interaction_indices) <= max_full:
        return 0
    return interaction_indices[-max_full]


def _has_tool_results(message: dict[str, Any]) -> bool:
    """Check whether a message contains tool_result blocks."""
    content = message.get("content")
    if not isinstance(content, list):
        return False
    return any(
        isinstance(block, dict) and block.get("type") == "tool_result"
        for block in content
    )


def _compact_message(
    message: dict[str, Any],
    index: int,
    keep_full_from: int,
) -> dict[str, Any]:
    """Return a possibly compacted copy of *message*."""
    if index >= keep_full_from:
        return message

    content = message.get("content")
    if not isinstance(content, list):
        return message

    compacted_content = tuple(_compact_content_block(block) for block in content)
    # Intentional type widening: content is returned as list (not tuple) to
    # match the Anthropic API message format expected by downstream consumers.
    return {**message, "content": list(compacted_content)}


def _compact_content_block(block: Any) -> Any:
    """Return a compacted copy of a single content block."""
    if not isinstance(block, dict):
        return block

    block_type = block.get("type")

    if block_type == "tool_result":
        return _truncate_tool_result(block)

    if block_type == "image":
        return {**block, "source": _SCREENSHOT_PLACEHOLDER}

    text = block.get("text", "")
    if isinstance(text, str) and "screenshot" in text.lower():
        return {**block, "text": _SCREENSHOT_PLACEHOLDER}

    return block


def _truncate_tool_result(block: dict[str, Any]) -> dict[str, Any]:
    """Return a truncated copy of a tool_result block."""
    content = block.get("content", "")
    if not isinstance(content, str) or len(content) <= _PREVIEW_LENGTH:
        return block

    preview = content[:_PREVIEW_LENGTH]
    truncated = _TRUNCATED_TEMPLATE.format(preview=preview)
    return {**block, "content": truncated}
