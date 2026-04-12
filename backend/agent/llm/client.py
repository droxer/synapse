"""Claude API client with tool support and streaming."""

import asyncio
import json
import re
import time
from pathlib import Path
from uuid import uuid4
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

import anthropic
from loguru import logger

# Maximum number of retry attempts for transient API errors
_MAX_RETRIES = 3
_CONTENT_POLICY_ERROR_PREFIX = "LLM content policy rejection: "
_CONTENT_POLICY_ERROR_SUMMARY = (
    "Model provider rejected the request because the prompt or recent tool "
    "output triggered content inspection."
)
_DEBUG_LOG_PATH = Path("/Users/feihe/Workspace/Synapse/.cursor/debug-caca61.log")
_DEBUG_SESSION_ID = "caca61"


def _emit_debug_log(
    *,
    run_id: str,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict[str, Any],
) -> None:
    payload = {
        "sessionId": _DEBUG_SESSION_ID,
        "id": f"log_{uuid4().hex}",
        "timestamp": int(time.time() * 1000),
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
    }
    try:
        _DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _DEBUG_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        return


class LLMContentPolicyError(RuntimeError):
    """Raised when the provider rejects a request due to content inspection."""


def _flatten_payload_strings(value: Any) -> list[str]:
    """Collect string leaves from nested error payloads."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        parts: list[str] = []
        for nested in value.values():
            parts.extend(_flatten_payload_strings(nested))
        return parts
    if isinstance(value, list | tuple):
        parts: list[str] = []
        for nested in value:
            parts.extend(_flatten_payload_strings(nested))
        return parts
    return []


def _extract_error_payload(exc: Exception) -> Any | None:
    """Return a structured provider error payload when one is available."""
    body = getattr(exc, "body", None)
    if body is not None:
        return body

    response = getattr(exc, "response", None)
    if response is None:
        return None

    try:
        return response.json()
    except Exception:
        return None


def _extract_content_policy_detail(exc: Exception) -> str | None:
    """Return a short provider detail string for moderation rejections."""
    payload = _extract_error_payload(exc)
    candidates = _flatten_payload_strings(payload) if payload is not None else []
    candidates.append(str(exc))

    matched = [
        text.strip()
        for text in candidates
        if isinstance(text, str)
        and (
            "data_inspection_failed" in text.lower()
            or "inappropriate content" in text.lower()
        )
    ]
    if not matched:
        return None

    detail = matched[0]
    return detail[:240]


def is_content_policy_error(error: Exception | str) -> bool:
    """Return True when a provider rejected the request for policy reasons."""
    if isinstance(error, str):
        return error.startswith(_CONTENT_POLICY_ERROR_PREFIX)

    if isinstance(error, LLMContentPolicyError):
        return True

    if not isinstance(error, anthropic.APIStatusError | anthropic.BadRequestError):
        return False

    status_code = getattr(
        error,
        "status_code",
        getattr(getattr(error, "response", None), "status_code", None),
    )
    if status_code != 400:
        return False

    return _extract_content_policy_detail(error) is not None


def format_llm_failure(exc: Exception) -> str:
    """Convert provider exceptions into stable runtime-facing messages."""
    if is_content_policy_error(exc):
        detail = _extract_content_policy_detail(exc)
        if detail:
            return (
                f"{_CONTENT_POLICY_ERROR_PREFIX}{_CONTENT_POLICY_ERROR_SUMMARY} "
                f"Provider detail: {detail}"
            )
        return f"{_CONTENT_POLICY_ERROR_PREFIX}{_CONTENT_POLICY_ERROR_SUMMARY}"

    return f"LLM call failed: {exc}"


@dataclass(frozen=True)
class TokenUsage:
    """Immutable token usage counters from the Claude API."""

    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class ToolCall:
    """Immutable representation of a tool invocation from the LLM."""

    id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True)
class LLMResponse:
    """Immutable response from the Claude API."""

    text: str
    tool_calls: tuple[ToolCall, ...]
    stop_reason: str
    usage: TokenUsage
    thinking: str = ""


def _extract_text_blocks(content: list) -> str:
    """Extract and concatenate text from TextBlock content items."""
    return "".join(block.text for block in content if block.type == "text")


def _extract_tool_calls(content: list) -> tuple[ToolCall, ...]:
    """Extract ToolCall objects from ToolUseBlock content items."""

    def _tool_input(block: Any) -> dict[str, Any]:
        raw_input = getattr(block, "input", None)
        parsed_arguments: dict[str, Any] = {}

        raw_arguments = getattr(block, "arguments", None)
        if isinstance(raw_arguments, str):
            try:
                parsed = json.loads(raw_arguments)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                parsed_arguments = parsed

        if isinstance(raw_input, dict) and raw_input:
            if parsed_arguments:
                return {**parsed_arguments, **raw_input}
            return raw_input

        if parsed_arguments:
            return parsed_arguments

        return raw_input if isinstance(raw_input, dict) else {}

    return tuple(
        ToolCall(id=block.id, name=block.name, input=_tool_input(block))
        for block in content
        if block.type == "tool_use"
    )


def _extract_thinking(content: list) -> str:
    """Extract and concatenate thinking text from thinking blocks.

    Handles both Anthropic-native ``thinking`` blocks and DashScope-compatible
    variants where the attribute may be ``reasoning_content``.
    """
    parts: list[str] = []
    for block in content:
        if block.type == "thinking":
            text = getattr(block, "thinking", "") or ""
            parts.append(text)
        elif block.type == "reasoning":
            text = (
                getattr(block, "reasoning_content", "")
                or getattr(block, "text", "")
                or ""
            )
            parts.append(text)
    return "".join(parts)


_THINK_TAG_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL)


def _split_think_tags(text: str) -> tuple[str, str]:
    """Split <think>...</think> blocks out of text.

    Returns (thinking_text, clean_text) where thinking_text concatenates all
    <think> block contents and clean_text is the remainder with tags removed.
    Some models (e.g. Qwen3 via OpenAI-compatible proxy) embed chain-of-thought
    reasoning inline using these tags instead of separate thinking blocks.
    """
    thinking_parts: list[str] = []

    def _collect(m: re.Match) -> str:
        thinking_parts.append(m.group(1).strip())
        return ""

    clean = _THINK_TAG_RE.sub(_collect, text).strip()
    return "\n\n".join(thinking_parts), clean


def _build_usage(usage: Any) -> TokenUsage:
    """Build a frozen TokenUsage from an API response usage object."""
    return TokenUsage(
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
    )


def _parse_response(response: Any) -> LLMResponse:
    """Parse an API response into an immutable LLMResponse.

    Supports Anthropic-native, DashScope Anthropic-compatible, and
    OpenAI-compatible formats.  Reasoning is resolved in priority order:
    1. Explicit thinking content blocks (Claude extended thinking).
    2. DashScope ``reasoning_content`` top-level attribute.
    3. Inline ``<think>`` tags (Qwen3 and similar models).
    """
    raw_text = _extract_text_blocks(response.content)
    explicit_thinking = _extract_thinking(response.content)

    if explicit_thinking:
        text = raw_text
        thinking = explicit_thinking
    else:
        # DashScope fallback: reasoning_content on the response object itself
        fallback = getattr(response, "reasoning_content", None)
        if isinstance(fallback, str) and fallback:
            text = raw_text
            thinking = fallback
        else:
            thinking, text = _split_think_tags(raw_text)

    return LLMResponse(
        text=text,
        tool_calls=_extract_tool_calls(response.content),
        stop_reason=response.stop_reason,
        usage=_build_usage(response.usage),
        thinking=thinking,
    )


class AnthropicClient:
    """Async client for the Claude API with tool support."""

    def __init__(
        self,
        api_key: str,
        default_model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 4096,
        base_url: str | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("api_key must not be empty")

        self._default_model = default_model
        self._default_max_tokens = max_tokens
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            base_url=base_url or None,
        )

    @property
    def default_model(self) -> str:
        """Configured default model id when callers omit ``model``."""
        return self._default_model

    async def close(self) -> None:
        """Close the underlying httpx client.

        Should be called at application shutdown to release connections.
        """
        await self._client.close()

    async def create_message(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        """Send a message to the Claude API and return a parsed response.

        Retries up to ``_MAX_RETRIES`` times on transient errors (rate limit,
        internal server error, connection error) using exponential backoff.

        Args:
            system: System prompt string.
            messages: Conversation messages in Anthropic format.
            tools: Optional tool definitions for function calling.
            model: Override the default model.
            max_tokens: Override the default max tokens.

        Returns:
            Parsed LLMResponse with text, tool calls, and usage.

        Raises:
            anthropic.APIError: On API-level failures that are not retried or
                that persist after all retry attempts are exhausted.
            ValueError: On invalid input parameters.
        """
        if not messages:
            raise ValueError("messages must not be empty")

        effective_model = model or self._default_model
        logger.debug(
            "llm_request model={} messages={} tools={}",
            effective_model,
            len(messages),
            len(tools or []),
        )

        kwargs: dict[str, Any] = {
            "model": effective_model,
            "max_tokens": max_tokens or self._default_max_tokens,
            "system": system,
            "messages": messages,
        }

        if tools:
            kwargs["tools"] = tools

        if thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            # Anthropic requires max_tokens >= thinking_budget when thinking is enabled
            min_max_tokens = thinking_budget + 1024
            if kwargs["max_tokens"] < min_max_tokens:
                kwargs["max_tokens"] = min_max_tokens

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._client.messages.create(**kwargs)
                if thinking_budget > 0:
                    block_types = [getattr(b, "type", "?") for b in response.content]
                    logger.debug(
                        "llm_response_blocks types={} has_reasoning_content={}",
                        block_types,
                        hasattr(response, "reasoning_content"),
                    )
                return _parse_response(response)
            except (
                anthropic.RateLimitError,
                anthropic.InternalServerError,
                anthropic.APIConnectionError,
                anthropic.APITimeoutError,
            ) as exc:
                last_exc = exc
                logger.warning(
                    "llm_retry model={} attempt={}/{} error={}",
                    effective_model,
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                )
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(2**attempt)

        # All retries exhausted — re-raise the last exception
        raise last_exc  # type: ignore[misc]

    async def create_message_stream(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        on_text_delta: Callable[[str], Coroutine[Any, Any, None]] | None = None,
        on_thinking_ready: Callable[[str], Coroutine[Any, Any, None]] | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        """Send a message to the Claude API with streaming, invoking on_text_delta for each token.

        Args:
            system: System prompt string.
            messages: Conversation messages in Anthropic format.
            tools: Optional tool definitions for function calling.
            model: Override the default model.
            max_tokens: Override the default max tokens.
            on_text_delta: Async callback invoked with each text chunk as it arrives.
            on_thinking_ready: Async callback invoked once with accumulated
                thinking text before the first visible output chunk.

        Returns:
            Parsed LLMResponse with complete text, tool calls, and usage.
        """
        if not messages:
            raise ValueError("messages must not be empty")

        effective_model = model or self._default_model
        logger.debug(
            "llm_stream_request model={} messages={}",
            effective_model,
            len(messages),
        )

        kwargs: dict[str, Any] = {
            "model": effective_model,
            "max_tokens": max_tokens or self._default_max_tokens,
            "system": system,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools

        if thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            # Anthropic requires max_tokens >= thinking_budget when thinking is enabled
            min_max_tokens = thinking_budget + 1024
            if kwargs["max_tokens"] < min_max_tokens:
                kwargs["max_tokens"] = min_max_tokens

        message_chars = sum(
            len(json.dumps(message, ensure_ascii=True)) for message in messages
        )
        tool_chars = len(json.dumps(tools or [], ensure_ascii=True))
        # region agent log
        _emit_debug_log(
            run_id="initial",
            hypothesis_id="H1",
            location="backend/agent/llm/client.py:create_message_stream:request",
            message="Prepared stream request payload stats",
            data={
                "model": effective_model,
                "messageCount": len(messages),
                "messageChars": message_chars,
                "systemChars": len(system),
                "toolCount": len(tools or []),
                "toolSchemaChars": tool_chars,
            },
        )
        # endregion
        # region agent log
        _emit_debug_log(
            run_id="initial",
            hypothesis_id="H2",
            location="backend/agent/llm/client.py:create_message_stream:thinking",
            message="Prepared stream token budget settings",
            data={
                "model": effective_model,
                "thinkingBudget": thinking_budget,
                "maxTokens": kwargs["max_tokens"],
                "thinkingEnabled": "thinking" in kwargs,
            },
        )
        # endregion

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                # region agent log
                _emit_debug_log(
                    run_id="initial",
                    hypothesis_id="H4",
                    location="backend/agent/llm/client.py:create_message_stream:attempt",
                    message="Starting stream attempt",
                    data={
                        "model": effective_model,
                        "attempt": attempt + 1,
                        "maxRetries": _MAX_RETRIES,
                    },
                )
                # endregion
                async with self._client.messages.stream(**kwargs) as stream:
                    thinking_snapshot = ""
                    emitted_thinking = False

                    async def _emit_thinking_once() -> None:
                        nonlocal emitted_thinking
                        if (
                            emitted_thinking
                            or on_thinking_ready is None
                            or not thinking_snapshot
                        ):
                            return
                        await on_thinking_ready(thinking_snapshot)
                        emitted_thinking = True

                    async for chunk in stream:
                        chunk_type = getattr(chunk, "type", "")
                        if chunk_type == "thinking":
                            snapshot = getattr(chunk, "snapshot", "")
                            if isinstance(snapshot, str) and snapshot:
                                thinking_snapshot = snapshot
                            continue

                        if chunk_type in {"text", "input_json", "content_block_start"}:
                            await _emit_thinking_once()

                        if chunk_type == "text" and on_text_delta is not None:
                            text_delta = getattr(chunk, "text", "")
                            if isinstance(text_delta, str) and text_delta:
                                await on_text_delta(text_delta)

                    await _emit_thinking_once()
                    response = await stream.get_final_message()
                if thinking_budget > 0:
                    block_types = [getattr(b, "type", "?") for b in response.content]
                    logger.debug(
                        "llm_stream_response_blocks types={} has_reasoning_content={}",
                        block_types,
                        hasattr(response, "reasoning_content"),
                    )
                return _parse_response(response)
            except (
                anthropic.RateLimitError,
                anthropic.InternalServerError,
                anthropic.APIConnectionError,
                anthropic.APITimeoutError,
            ) as exc:
                last_exc = exc
                logger.warning(
                    "llm_retry model={} attempt={}/{} error={}",
                    effective_model,
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                )
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(2**attempt)
            except Exception as exc:
                # region agent log
                _emit_debug_log(
                    run_id="initial",
                    hypothesis_id="H5",
                    location="backend/agent/llm/client.py:create_message_stream:error",
                    message="Non-retryable stream error details",
                    data={
                        "model": effective_model,
                        "errorType": type(exc).__name__,
                        "errorText": str(exc)[:500],
                        "providerPayload": _extract_error_payload(exc),
                    },
                )
                # endregion
                raise

        raise last_exc  # type: ignore[misc]
