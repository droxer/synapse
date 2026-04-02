"""Context compaction observer for the agent loop.

Manages message history size using token-aware tiered compaction:
- **Hot tier**: Recent interactions kept verbatim.
- **Warm tier**: Older interactions summarised via a lightweight LLM call.
- **Fallback**: If summarisation fails, older results fall back to semantic
  tool summaries when possible, otherwise a truncated preview marker.

All pure helpers return new objects — input messages are never mutated.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Callable

from loguru import logger

if TYPE_CHECKING:
    from agent.llm.client import AnthropicClient

_SCREENSHOT_PLACEHOLDER = "[screenshot captured]"
_DEFAULT_PREVIEW_LENGTH = 500
_DEFAULT_RESULT_LENGTH = 1000

_SUMMARISE_SYSTEM = (
    "Summarize the following agent-tool interactions into a concise bullet list. "
    "For each interaction, capture: what tool was used, what the intent was, and "
    "what the key outcome was. Be specific about errors, values, and findings. "
    "Keep each bullet to 1-2 sentences. Output only the bullet list."
)


# ------------------------------------------------------------------
# Token estimation
# ------------------------------------------------------------------


def _estimate_text_tokens(text: str) -> int:
    """Estimate token count with CJK-aware weighting.

    ASCII chars: ~4 chars per token (standard English ratio)
    CJK chars: ~1.5 tokens per char (CJK characters are denser)
    Other non-ASCII: ~1 token per char
    """
    ascii_chars = sum(1 for char in text if ord(char) < 128)
    non_ascii_chars = len(text) - ascii_chars

    # Estimate CJK characters (CJK Unified Ideographs, Hiragana, Katakana, Hangul)
    cjk_chars = sum(
        1
        for char in text
        if (
            (0x4E00 <= ord(char) <= 0x9FFF)  # CJK Unified Ideographs
            or (0x3040 <= ord(char) <= 0x309F)  # Hiragana
            or (0x30A0 <= ord(char) <= 0x30FF)  # Katakana
            or (0xAC00 <= ord(char) <= 0xD7AF)  # Hangul Syllables
            or (0x3400 <= ord(char) <= 0x4DBF)  # CJK Extension A
            or (0x20000 <= ord(char) <= 0x2A6DF)  # CJK Extension B
        )
    )
    other_non_ascii = non_ascii_chars - cjk_chars

    # Weighted calculation: ASCII/4 + CJK*1.5 + other_non_ascii*1.0
    return max(
        1,
        (ascii_chars + 3) // 4 + int(cjk_chars * 1.5) + other_non_ascii,
    )


def _estimate_text_tokens_legacy(text: str) -> int:
    return max(1, len(text) // 4)


def _get_text_token_estimator() -> Callable[[str], int]:
    """Return the configured text token estimator."""
    from config.settings import get_settings

    strategy = get_settings().COMPACT_TOKEN_COUNTER
    if strategy == "legacy":
        return _estimate_text_tokens_legacy
    if strategy == "weighted":
        return _estimate_text_tokens
    raise ValueError(f"unknown token estimation strategy: {strategy}")


def _get_fallback_truncation_limits() -> tuple[int, int]:
    """Return preview/result limits for fallback truncation."""
    from config.settings import get_settings

    settings = get_settings()
    return (
        getattr(
            settings,
            "COMPACT_FALLBACK_PREVIEW_CHARS",
            _DEFAULT_PREVIEW_LENGTH,
        ),
        getattr(
            settings,
            "COMPACT_FALLBACK_RESULT_CHARS",
            _DEFAULT_RESULT_LENGTH,
        ),
    )


def _estimate_tokens(
    messages: tuple[dict[str, Any], ...],
    system_prompt: str = "",
) -> int:
    """Fast heuristic for compaction-only token estimation.

    Accurate enough for deciding *when* to compact — not for billing.
    """
    estimate_text_tokens = _get_text_token_estimator()
    total = estimate_text_tokens(system_prompt) if system_prompt else 0
    for msg in messages:
        total += estimate_text_tokens(json.dumps(msg, default=str, ensure_ascii=False))
    return total


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
        system_prompt: str = "",
    ) -> tuple[dict[str, Any], ...]:
        """Return a compacted copy of *messages*.

        Strategy
        --------
        1. The first user message (original task) is kept verbatim.
        2. The last ``max_full_interactions`` tool interaction pairs
           are kept in full (**hot tier**).
        3. Older interactions are summarised into a single assistant
           message via a lightweight LLM call (**warm tier**). If the
           LLM call fails, older results fall back to structured compaction.
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
        tool_use_map = _build_tool_use_map(warm_messages)
        compacted_warm = tuple(
            _compact_message(msg, idx=0, keep_full_from=1, tool_use_map=tool_use_map)
            for msg in warm_messages
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
    return max(0, interaction_indices[-max_full] - 1)


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
    tool_use_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a possibly compacted copy of *message*.

    Parameters
    ----------
    tool_use_map:
        Maps ``tool_use_id`` → ``{"name": ..., "input": ...}`` so that
        compacted tool results can include a semantic summary instead of
        a raw text preview.
    """
    if idx >= keep_full_from:
        return message

    content = message.get("content")
    if not isinstance(content, list):
        return message

    compacted_content = [
        _compact_content_block(block, tool_use_map=tool_use_map) for block in content
    ]
    return {**message, "content": compacted_content}


def _compact_content_block(
    block: Any,
    tool_use_map: dict[str, dict[str, Any]] | None = None,
) -> Any:
    """Return a compacted copy of a single content block."""
    if not isinstance(block, dict):
        return block

    block_type = block.get("type")

    if block_type == "tool_result":
        return _truncate_tool_result(block, tool_use_map=tool_use_map)

    if block_type == "image":
        return {**block, "source": _SCREENSHOT_PLACEHOLDER}

    text = block.get("text", "")
    if isinstance(text, str) and "screenshot" in text.lower():
        return {**block, "text": _SCREENSHOT_PLACEHOLDER}

    return block


def _build_tool_use_map(
    messages: list[dict[str, Any]] | tuple[dict[str, Any], ...],
) -> dict[str, dict[str, Any]]:
    """Scan messages to build a map of tool_use_id → {name, input}."""
    result: dict[str, dict[str, Any]] = {}
    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                result[block.get("id", "")] = {
                    "name": block.get("name", ""),
                    "input": block.get("input", {}),
                }
    return result


def _summarize_tool_call(
    tool_name: str,
    tool_input: dict[str, Any],
    content_text: str,
    is_error: bool,
) -> str:
    """Build a one-line semantic summary of a tool call + result.

    Examples:
        ``web_search("AI agents") → success, 5 results``
        ``shell_exec("npm test") → error: exit code 1``
        ``file_write("/app/main.py") → success``
    """
    # Extract the most meaningful input parameter
    key_param = ""
    for candidate in ("query", "command", "url", "path", "code", "task", "id", "name"):
        val = tool_input.get(candidate)
        if val and isinstance(val, str):
            key_param = val[:60]
            break

    call_repr = f'{tool_name}("{key_param}")' if key_param else tool_name
    status = "error" if is_error else "success"

    # Add a brief outcome hint
    hint = ""
    if not is_error and content_text:
        # Count result items if JSON array-like
        stripped = content_text.strip()
        if stripped.startswith("[") or stripped.startswith("{"):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    hint = f", {len(parsed)} results"
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

    return f"{call_repr} → {status}{hint}"


def _structured_tool_result(
    block: dict[str, Any],
    tool_use_map: dict[str, dict[str, Any]] | None,
    preview_chars: int,
    result_chars: int,
) -> dict[str, Any]:
    text = _flatten_content(block.get("content", ""))
    tool_use_id = block.get("tool_use_id", "")
    compacted = text

    if tool_use_map and tool_use_id in tool_use_map:
        info = tool_use_map[tool_use_id]
        summary = _summarize_tool_call(
            info["name"],
            info.get("input", {}),
            text,
            is_error=bool(block.get("is_error")),
        )
        preview = text[:preview_chars]
        compacted = f"[{summary}] {preview}"
    else:
        expanded = text[:result_chars]
        compacted = f"{expanded}...[HISTORY_TRUNCATED]"

    return {**block, "content": compacted if len(compacted) <= len(text) else text}


def _truncate_tool_result(
    block: dict[str, Any],
    tool_use_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a truncated copy of a tool_result block.

    Error results (``is_error: True``) are never truncated — preserving
    them helps the model learn from failures within a session (Manus-style
    append-only error preservation).
    """
    # Never truncate error results — the model learns from failures
    if block.get("is_error"):
        return block

    content = block.get("content", "")

    # Non-string, non-list content (e.g. numeric) — leave untouched
    if not isinstance(content, (str, list)):
        return block

    text = _flatten_content(content) if isinstance(content, list) else content

    preview_chars, result_chars = _get_fallback_truncation_limits()

    if isinstance(text, str) and len(text) <= preview_chars:
        return block

    return _structured_tool_result(
        block,
        tool_use_map=tool_use_map,
        preview_chars=preview_chars,
        result_chars=result_chars,
    )
