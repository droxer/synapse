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

_DIALOGUE_SUMMARISE_SYSTEM = (
    "Summarize the following chat turns between a user and an assistant. "
    "Preserve: names, dates, decisions, preferences, open questions, and "
    "any commitments or todos. Use a concise bullet list. "
    "Output only the bullet list, no preamble."
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


def _get_dialogue_fallback_chars() -> int:
    from config.settings import get_settings

    return getattr(get_settings(), "COMPACT_DIALOGUE_FALLBACK_CHARS", 12_000)


def _message_plain_text(message: dict[str, Any]) -> str:
    """Flatten a Claude-style message to plain text for dialogue compaction."""
    content = message.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            if btype == "text":
                parts.append(str(block.get("text", "")))
            elif btype == "tool_result":
                parts.append(_flatten_content(block.get("content", "")))
        return " ".join(parts).strip()
    return str(content).strip()


def _dialogue_transcript(messages: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for msg in messages:
        role = msg.get("role", "?")
        text = _message_plain_text(msg)
        if text:
            lines.append(f"[{role}] {text}")
    return "\n".join(lines)


def _truncate_transcript_chars(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    head = max_chars // 2
    tail = max_chars - head - 30
    return f"{text[:head]}\n...[truncated]...\n{text[-tail:]}"


def _truncate_tail_chars(text: str, max_chars: int, marker: str) -> str:
    """Keep the tail of *text* while preserving an explicit truncation marker."""
    if len(text) <= max_chars:
        return text
    if max_chars <= len(marker):
        return marker[:max_chars]
    return f"{marker}{text[-(max_chars - len(marker)) :]}"


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


def compaction_summary_for_persistence(
    messages: tuple[dict[str, Any], ...],
) -> str | None:
    """Extract synthetic summary text produced by :meth:`Observer.compact`."""
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if not isinstance(content, str):
            continue
        if content.startswith("## Earlier conversation") or content.startswith(
            "## Previous work"
        ):
            return content
    return None


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
        max_full_dialogue_turns: int = 5,
        token_budget: int = 150_000,
        claude_client: AnthropicClient | None = None,
        summary_model: str = "",
    ) -> None:
        if max_full_interactions < 1:
            raise ValueError("max_full_interactions must be >= 1")
        if max_full_dialogue_turns < 1:
            raise ValueError("max_full_dialogue_turns must be >= 1")
        if token_budget < 1:
            raise ValueError("token_budget must be >= 1")
        self._max_full_interactions = max_full_interactions
        self._max_full_dialogue_turns = max_full_dialogue_turns
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

        **Dialogue mode** (no ``tool_result`` blocks, typical DB replay):
        summarises older user/assistant text into ``## Earlier conversation``.
        """
        if len(messages) <= 1:
            return messages

        if _estimate_tokens(messages, system_prompt) <= self._token_budget:
            return messages

        first_message = messages[0]
        remaining = list(messages[1:])

        interaction_indices = _find_tool_interaction_indices(remaining)
        keep_full_from = _compute_full_boundary(
            interaction_indices,
            self._max_full_interactions,
        )

        if (
            keep_full_from == 0
            and interaction_indices
            and _estimate_tokens(messages, system_prompt) > self._token_budget
        ):
            for reduced in range(self._max_full_interactions - 1, 0, -1):
                keep_full_from = _compute_full_boundary(interaction_indices, reduced)
                if keep_full_from > 0:
                    break

        if keep_full_from == 0:
            if not interaction_indices:
                return await self._compact_pure_dialogue(messages, system_prompt)
            return await self._compact_tool_hot_overflow(
                first_message,
                remaining,
                system_prompt,
            )

        warm_messages = remaining[:keep_full_from]
        hot_messages = remaining[keep_full_from:]

        summary = await self._summarise(warm_messages)

        if summary is not None:
            summary_message: dict[str, Any] = {
                "role": "assistant",
                "content": f"## Previous work\n{summary}",
            }
            return self._shrink_tool_candidate(
                (first_message, summary_message, *hot_messages),
                system_prompt,
            )

        logger.warning("llm_summarisation_failed, falling back to truncation")
        tool_use_map = _build_tool_use_map(warm_messages)
        compacted_warm = tuple(
            _compact_message(msg, idx=0, keep_full_from=1, tool_use_map=tool_use_map)
            for msg in warm_messages
        )
        return self._shrink_tool_candidate(
            (first_message, *compacted_warm, *hot_messages),
            system_prompt,
        )

    async def _compact_pure_dialogue(
        self,
        messages: tuple[dict[str, Any], ...],
        system_prompt: str,
    ) -> tuple[dict[str, Any], ...]:
        """Summarise middle text turns; keep first message and a recent tail."""
        first_message = messages[0]
        rest = list(messages[1:])
        max_tail_msgs = max(2, 2 * self._max_full_dialogue_turns)
        tail_n = min(max_tail_msgs, len(rest))
        fb_chars = _get_dialogue_fallback_chars()

        for _ in range(16):
            middle = rest[:-tail_n] if len(rest) > tail_n else []
            tail = rest[-tail_n:] if tail_n else []

            if middle:
                summary = await self._summarise_dialogue(middle)
                if summary is None:
                    summary = _truncate_transcript_chars(
                        _dialogue_transcript(middle),
                        fb_chars,
                    )
                summary_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": f"## Earlier conversation\n{summary}",
                }
                candidate = (first_message, summary_msg, *tail)
            else:
                transcript = _dialogue_transcript(rest)
                truncated = _truncate_transcript_chars(transcript, fb_chars)
                summary_msg = {
                    "role": "assistant",
                    "content": f"## Earlier conversation\n{truncated}",
                }
                candidate = (first_message, summary_msg)

            if _estimate_tokens(candidate, system_prompt) <= self._token_budget:
                return candidate

            if tail_n >= len(rest) and not middle:
                return self._shrink_dialogue_candidate(candidate, system_prompt)

            tail_n = max(2, tail_n // 2)
            if tail_n > len(rest):
                tail_n = len(rest)

        return self._shrink_dialogue_candidate(candidate, system_prompt)

    def _shrink_dialogue_candidate(
        self,
        candidate: tuple[dict[str, Any], ...],
        system_prompt: str,
    ) -> tuple[dict[str, Any], ...]:
        """Halve synthetic summary body until within budget or floor reached."""
        msgs = list(candidate)
        fb_chars = _get_dialogue_fallback_chars()
        for _ in range(24):
            if _estimate_tokens(tuple(msgs), system_prompt) <= self._token_budget:
                return tuple(msgs)
            shrunk = False
            for i, msg in enumerate(msgs):
                content = msg.get("content")
                if (
                    msg.get("role") == "assistant"
                    and isinstance(content, str)
                    and content.startswith("## Earlier conversation\n")
                ):
                    body = content.split("\n", 1)[-1]
                    if len(body) <= 200:
                        continue
                    new_len = max(200, len(body) // 2)
                    new_body = (
                        _truncate_transcript_chars(body, new_len) + "\n[truncated]"
                    )
                    msgs[i] = {
                        **msg,
                        "content": "## Earlier conversation\n" + new_body,
                    }
                    shrunk = True
                    break
            if not shrunk:
                break
        if _estimate_tokens(tuple(msgs), system_prompt) > self._token_budget:
            # Last resort: keep first + tiny summary
            first = msgs[0]
            summary_piece = _truncate_transcript_chars(
                _dialogue_transcript(msgs[1:]),
                min(800, fb_chars),
            )
            return (
                first,
                {
                    "role": "assistant",
                    "content": "## Earlier conversation\n" + summary_piece,
                },
            )
        return tuple(msgs)

    async def _compact_tool_hot_overflow(
        self,
        first_message: dict[str, Any],
        remaining: list[dict[str, Any]],
        system_prompt: str,
    ) -> tuple[dict[str, Any], ...]:
        """All tool interactions fit in hot tier but total tokens still exceed budget."""
        keep_suffix = min(len(remaining), max(4, self._max_full_interactions * 2))
        warm_messages = remaining[:-keep_suffix] if keep_suffix else remaining
        hot_messages = remaining[-keep_suffix:] if keep_suffix else []

        if not warm_messages:
            tool_use_map = _build_tool_use_map(remaining)
            n = len(remaining)
            compacted = tuple(
                _compact_message(
                    msg, idx=i, keep_full_from=n, tool_use_map=tool_use_map
                )
                for i, msg in enumerate(remaining)
            )
            return self._shrink_tool_candidate(
                (first_message, *compacted),
                system_prompt,
            )

        summary = await self._summarise(warm_messages)
        if summary is not None:
            summary_message: dict[str, Any] = {
                "role": "assistant",
                "content": f"## Previous work\n{summary}",
            }
            return self._shrink_tool_candidate(
                (first_message, summary_message, *hot_messages),
                system_prompt,
            )

        logger.warning(
            "tool_hot_overflow_summarisation_failed, falling back to truncation"
        )
        tool_use_map = _build_tool_use_map(warm_messages)
        wn = len(warm_messages)
        compacted_warm = tuple(
            _compact_message(msg, idx=i, keep_full_from=wn, tool_use_map=tool_use_map)
            for i, msg in enumerate(warm_messages)
        )
        return self._shrink_tool_candidate(
            (first_message, *compacted_warm, *hot_messages),
            system_prompt,
        )

    def _shrink_tool_candidate(
        self,
        candidate: tuple[dict[str, Any], ...],
        system_prompt: str,
    ) -> tuple[dict[str, Any], ...]:
        """Iteratively shrink tool-thread candidates until they fit the budget."""
        msgs = list(candidate)
        for _ in range(32):
            if _estimate_tokens(tuple(msgs), system_prompt) <= self._token_budget:
                return tuple(msgs)
            if self._shrink_previous_work_summary(msgs):
                continue
            if _shrink_tool_result_block(msgs):
                continue
            if len(msgs) > 2:
                msgs = [
                    msgs[0],
                    {
                        "role": "assistant",
                        "content": "## Previous work\n"
                        + _truncate_transcript_chars(
                            _tool_history_transcript(msgs[1:]),
                            min(800, _get_dialogue_fallback_chars()),
                        ),
                    },
                ]
                continue
            break
        return tuple(msgs)

    def _shrink_previous_work_summary(self, msgs: list[dict[str, Any]]) -> bool:
        """Shorten synthetic tool-history summaries in place."""
        for idx, msg in enumerate(msgs):
            content = msg.get("content")
            if (
                msg.get("role") != "assistant"
                or not isinstance(content, str)
                or not content.startswith("## Previous work\n")
            ):
                continue
            body = content.split("\n", 1)[-1]
            if len(body) <= 40:
                continue
            new_len = max(40, len(body) // 2)
            msgs[idx] = {
                **msg,
                "content": "## Previous work\n"
                + _truncate_tail_chars(body, new_len, "[truncated]\n"),
            }
            return True
        return False

    # ------------------------------------------------------------------
    # Summarisation (warm tier)
    # ------------------------------------------------------------------

    async def _summarise_dialogue(
        self,
        messages: list[dict[str, Any]],
    ) -> str | None:
        """Summarise plain user/assistant dialogue turns."""
        if self._client is None or not self._summary_model:
            return None

        transcript = _dialogue_transcript(messages)
        if not transcript.strip():
            return None

        try:
            response = await self._client.create_message(
                system=_DIALOGUE_SUMMARISE_SYSTEM,
                messages=[{"role": "user", "content": transcript[:80_000]}],
                model=self._summary_model,
                max_tokens=1024,
            )
            return response.text.strip() if response.text else None
        except Exception:
            logger.opt(exception=True).warning("dialogue_summarisation_error")
            return None

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


def _tool_history_transcript(messages: list[dict[str, Any]]) -> str:
    """Flatten tool-thread history to plain text for last-resort summaries."""
    lines: list[str] = []
    for msg in messages:
        role = msg.get("role", "?")
        content = msg.get("content", "")
        if isinstance(content, str):
            if content.strip():
                lines.append(f"[{role}] {content.strip()}")
            continue
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if block_type == "tool_use":
                lines.append(
                    "[assistant:tool_use] "
                    f"{block.get('name', '?')}({json.dumps(block.get('input', {}), default=str)[:200]})"
                )
            elif block_type == "tool_result":
                lines.append(
                    "[tool_result] " + _flatten_content(block.get("content", ""))[:500]
                )
            elif block_type == "text":
                text = str(block.get("text", "")).strip()
                if text:
                    lines.append(f"[{role}:text] {text}")
    return "\n".join(lines)


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


def _shrink_tool_result_block(messages: list[dict[str, Any]]) -> bool:
    """Aggressively shorten the oldest non-error tool result in place."""
    for msg_index in range(1, len(messages)):
        content = messages[msg_index].get("content")
        if not isinstance(content, list):
            continue
        updated_blocks: list[Any] = []
        changed = False
        for block in content:
            if (
                changed
                or not isinstance(block, dict)
                or block.get("type") != "tool_result"
                or block.get("is_error")
            ):
                updated_blocks.append(block)
                continue
            text = _flatten_content(block.get("content", ""))
            if len(text) <= 40:
                updated_blocks.append(block)
                continue
            new_len = max(40, len(text) // 2)
            updated_blocks.append(
                {
                    **block,
                    "content": _truncate_tail_chars(
                        text,
                        new_len,
                        "...[HISTORY_TRUNCATED]",
                    ),
                }
            )
            changed = True
        if changed:
            messages[msg_index] = {
                **messages[msg_index],
                "content": updated_blocks,
            }
            return True
    return False
