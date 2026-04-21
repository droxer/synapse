"""Claude API client with tool support, prompt sections, and streaming."""

import asyncio
import json
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import anthropic
from loguru import logger
from config.settings import get_settings

# Maximum number of retry attempts for transient API errors
_MAX_RETRIES = 3
_CONTENT_POLICY_ERROR_PREFIX = "LLM content policy rejection: "
_CONTENT_POLICY_ERROR_SUMMARY = (
    "Model provider rejected the request because the prompt or recent tool "
    "output triggered content inspection."
)


class LLMContentPolicyError(RuntimeError):
    """Raised when the provider rejects a request due to content inspection."""


PromptCacheType = Literal["ephemeral"]


@dataclass(frozen=True)
class PromptCacheControl:
    """Anthropic-compatible cache-control metadata for prompt blocks."""

    type: PromptCacheType = "ephemeral"
    ttl: str | None = None


@dataclass(frozen=True)
class PromptTextBlock:
    """Typed system-prompt text block with optional cache metadata."""

    text: str
    cache_control: PromptCacheControl | None = None


SystemPrompt = str | Sequence[PromptTextBlock]


def _serialize_cache_control(
    cache_control: PromptCacheControl | None,
) -> dict[str, Any] | None:
    """Return provider-ready cache metadata, omitting unset fields."""
    if cache_control is None:
        return None
    payload: dict[str, Any] = {"type": cache_control.type}
    if cache_control.ttl:
        payload["ttl"] = cache_control.ttl
    return payload


def build_system_prompt_blocks(
    *sections: str | PromptTextBlock,
) -> tuple[PromptTextBlock, ...]:
    """Build system-prompt blocks from raw strings and prebuilt blocks."""
    blocks: list[PromptTextBlock] = []
    for section in sections:
        if isinstance(section, PromptTextBlock):
            if section.text:
                blocks.append(section)
            continue
        if section:
            blocks.append(PromptTextBlock(text=section))
    return tuple(blocks)


def render_system_prompt(system: SystemPrompt) -> str:
    """Flatten a system prompt to text for logs, tests, and estimation."""
    if isinstance(system, str):
        return system
    return "\n\n".join(block.text for block in system if block.text)


def _serialize_system_prompt(system: SystemPrompt) -> str | list[dict[str, Any]]:
    """Normalize system prompt input for the Anthropic API."""
    if isinstance(system, str):
        return system

    blocks: list[dict[str, Any]] = []
    for block in system:
        if not block.text:
            continue
        payload: dict[str, Any] = {"type": "text", "text": block.text}
        cache_payload = _serialize_cache_control(block.cache_control)
        if cache_payload is not None:
            payload["cache_control"] = cache_payload
        blocks.append(payload)
    return blocks


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

    Only explicit provider-native ``thinking`` blocks are treated as hidden
    reasoning. Ambiguous reasoning text should remain in visible assistant text.
    """
    parts: list[str] = []
    for block in content:
        if block.type == "thinking":
            text = getattr(block, "thinking", "") or ""
            parts.append(text)
    return "".join(parts)


def _build_usage(usage: Any) -> TokenUsage:
    """Build a frozen TokenUsage from an API response usage object."""
    return TokenUsage(
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
    )


def _parse_response(response: Any) -> LLMResponse:
    """Parse an API response into an immutable LLMResponse.

    Supports Anthropic-compatible response formats. Hidden reasoning is extracted
    only from explicit provider thinking blocks.
    """
    raw_text = _extract_text_blocks(response.content)
    explicit_thinking = _extract_thinking(response.content)
    text = raw_text
    thinking = explicit_thinking

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
        system: SystemPrompt,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        thinking_budget: int = 0,
        request_cache_control: PromptCacheControl | None = None,
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
            "system": _serialize_system_prompt(system),
            "messages": messages,
        }

        if tools:
            kwargs["tools"] = tools
        cache_payload = _serialize_cache_control(request_cache_control)
        if cache_payload is not None:
            kwargs["cache_control"] = cache_payload

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
        system: SystemPrompt,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        on_text_delta: Callable[[str], Coroutine[Any, Any, None]] | None = None,
        on_thinking_ready: Callable[[str], Coroutine[Any, Any, None]] | None = None,
        thinking_budget: int = 0,
        request_cache_control: PromptCacheControl | None = None,
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
            "system": _serialize_system_prompt(system),
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools
        cache_payload = _serialize_cache_control(request_cache_control)
        if cache_payload is not None:
            kwargs["cache_control"] = cache_payload

        if thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            # Anthropic requires max_tokens >= thinking_budget when thinking is enabled
            min_max_tokens = thinking_budget + 1024
            if kwargs["max_tokens"] < min_max_tokens:
                kwargs["max_tokens"] = min_max_tokens

        debug_logging_enabled = get_settings().AGENT_DEBUG_LOGGING

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                if debug_logging_enabled:
                    logger.debug(
                        "llm_stream_attempt model={} attempt={}/{} messages={} tools={} thinking={}",
                        effective_model,
                        attempt + 1,
                        _MAX_RETRIES,
                        len(messages),
                        len(tools or []),
                        thinking_budget > 0,
                    )
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
                if debug_logging_enabled:
                    logger.debug(
                        "llm_stream_non_retryable_error model={} error_type={} payload={}",
                        effective_model,
                        type(exc).__name__,
                        _extract_error_payload(exc),
                    )
                raise

        raise last_exc  # type: ignore[misc]
