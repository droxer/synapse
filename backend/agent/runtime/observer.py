"""Context compaction observer for the agent loop.

Manages message history size using token-aware tiered compaction:
- **Hot tier**: Recent interactions kept verbatim.
- **Warm tier**: Older interactions summarised via a lightweight LLM call.
- **Fallback**: If summarisation fails, older results are truncated to a
  short preview (same behaviour as the legacy approach).

All pure helpers return new objects — input messages are never mutated.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from loguru import logger

if TYPE_CHECKING:
    from agent.llm.client import AnthropicClient

_TRUNCATED_TEMPLATE = "[tool_result truncated: {preview}...]"
_SCREENSHOT_PLACEHOLDER = "[screenshot captured]"
_PREVIEW_LENGTH = 100

_SUMMARISE_SYSTEM = (
    "Summarize the following agent-tool interactions into a concise bullet list. "
    "For each interaction, capture: what tool was used, what the intent was, and "
    "what the key outcome was. Be specific about errors, values, and findings. "
    "Keep each bullet to 1-2 sentences. Output only the bullet list."
)


# ------------------------------------------------------------------
# Token estimation
# ------------------------------------------------------------------


def _estimate_tokens(
    messages: tuple[dict[str, Any], ...],
    system_prompt: str = "",
) -> int:
    """Fast heuristic: ~4 characters per token.

    Accurate enough for deciding *when* to compact — not for billing.
    """
    total = len(system_prompt)
    for msg in messages:
        total += len(json.dumps(msg, default=str))
    return total // 4


# ------------------------------------------------------------------
# Observer
# ------------------------------------------------------------------


class Observer:
    """Monitors and compacts agent message history.

    Keeps the original user task and recent interactions in full,
    while summarising older tool outputs to reduce context size.
    """

    def __init__(
        self,
        *,
        max_full_interactions: int = 5,
        token_budget: int = 150_000,
        claude_client: AnthropicClient | None = None,
        summary_model: str = "",
    ) -> None:
        if max_full_interactions < 1:
            raise ValueError("max_full_interactions must be >= 1")
        if token_budget < 1:
            raise ValueError("token_budget must be >= 1")
        self._max_full_interactions = max_full_interactions
        self._token_budget = token_budget
        self._client = claude_client
        self._summary_model = summary_model

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def should_compact(
        self,
        messages: tuple[dict[str, Any], ...],
        system_prompt: str = "",
    ) -> bool:
        """Return True when estimated tokens exceed the budget."""
        return _estimate_tokens(messages, system_prompt) > self._token_budget

    async def compact(
        self,
        messages: tuple[dict[str, Any], ...],
    ) -> tuple[dict[str, Any], ...]:
        """Return a compacted copy of *messages*.

        Strategy
        --------
        1. The first user message (original task) is kept verbatim.
        2. The last ``max_full_interactions`` tool interaction pairs
           are kept in full (**hot tier**).
        3. Older interactions are summarised into a single assistant
           message via a lightweight LLM call (**warm tier**).  If the
           LLM call fails, older results fall back to truncation.
        """
        if len(messages) <= 1:
            return messages

        first_message = messages[0]
        remaining = list(messages[1:])

        # Identify the boundary between warm and hot tiers
        interaction_indices = _find_tool_interaction_indices(remaining)
        keep_full_from = _compute_full_boundary(
            interaction_indices,
            self._max_full_interactions,
        )

        if keep_full_from == 0:
            # Everything fits in the hot tier — nothing to compact
            return messages

        warm_messages = remaining[:keep_full_from]
        hot_messages = remaining[keep_full_from:]

        # Attempt LLM summarisation of the warm tier
        summary = await self._summarise(warm_messages)

        if summary is not None:
            summary_message: dict[str, Any] = {
                "role": "assistant",
                "content": f"## Previous work\n{summary}",
            }
            return (first_message, summary_message, *hot_messages)

        # Fallback: truncate warm-tier tool results in-place
        logger.warning("llm_summarisation_failed, falling back to truncation")
        compacted_warm = tuple(
            _compact_message(msg, idx=0, keep_full_from=1) for msg in warm_messages
        )
        return (first_message, *compacted_warm, *hot_messages)

    # ------------------------------------------------------------------
    # Summarisation (warm tier)
    # ------------------------------------------------------------------

    async def _summarise(
        self,
        messages: list[dict[str, Any]],
    ) -> str | None:
        """Summarise *messages* via a lightweight LLM call.

        Returns ``None`` when no client is configured or the call fails.
        """
        if self._client is None or not self._summary_model:
            return None

        # Build a simplified text representation of the interactions
        lines: list[str] = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, str):
                lines.append(f"[{role}] {content[:500]}")
            elif isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type", "")
                    if btype == "tool_use":
                        lines.append(
                            f"[assistant:tool_use] {block.get('name', '?')}"
                            f"({json.dumps(block.get('input', {}), default=str)[:200]})"
                        )
                    elif btype == "tool_result":
                        raw = block.get("content", "")
                        text = _flatten_content(raw)[:300]
                        lines.append(f"[tool_result] {text}")
                    elif btype == "text":
                        lines.append(f"[{role}:text] {block.get('text', '')[:300]}")

        if not lines:
            return None

        user_msg = "\n".join(lines)

        try:
            response = await self._client.create_message(
                system=_SUMMARISE_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
                model=self._summary_model,
                max_tokens=1024,
            )
            return response.text.strip() if response.text else None
        except Exception:
            logger.opt(exception=True).warning("context_summarisation_error")
            return None


# ------------------------------------------------------------------
# Pure helper functions
# ------------------------------------------------------------------


def _flatten_content(content: Any) -> str:
    """Flatten tool_result content to a plain string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return " ".join(parts)
    return str(content)


def _find_tool_interaction_indices(
    messages: list[dict[str, Any]] | tuple[dict[str, Any], ...],
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
    idx: int,
    keep_full_from: int,
) -> dict[str, Any]:
    """Return a possibly compacted copy of *message*."""
    if idx >= keep_full_from:
        return message

    content = message.get("content")
    if not isinstance(content, list):
        return message

    compacted_content = [_compact_content_block(block) for block in content]
    return {**message, "content": compacted_content}


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

    if isinstance(content, list):
        text = _flatten_content(content)
        if len(text) <= _PREVIEW_LENGTH:
            return block
        preview = text[:_PREVIEW_LENGTH]
        return {**block, "content": _TRUNCATED_TEMPLATE.format(preview=preview)}

    if isinstance(content, str) and len(content) > _PREVIEW_LENGTH:
        preview = content[:_PREVIEW_LENGTH]
        return {**block, "content": _TRUNCATED_TEMPLATE.format(preview=preview)}

    return block
