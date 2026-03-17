"""Claude API client with tool support and streaming."""

import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

import anthropic
from loguru import logger

# Maximum number of retry attempts for transient API errors
_MAX_RETRIES = 3


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
    return tuple(
        ToolCall(id=block.id, name=block.name, input=block.input)
        for block in content
        if block.type == "tool_use"
    )


def _extract_thinking(content: list) -> str:
    """Extract and concatenate thinking text from thinking blocks."""
    return "".join(block.thinking for block in content if block.type == "thinking")


def _build_usage(usage: Any) -> TokenUsage:
    """Build a frozen TokenUsage from an API response usage object."""
    return TokenUsage(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )


def _parse_response(response: Any) -> LLMResponse:
    """Parse an Anthropic API response into an immutable LLMResponse."""
    return LLMResponse(
        text=_extract_text_blocks(response.content),
        tool_calls=_extract_tool_calls(response.content),
        stop_reason=response.stop_reason,
        usage=_build_usage(response.usage),
        thinking=_extract_thinking(response.content),
    )


class ClaudeClient:
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
                return _parse_response(response)
            except (
                anthropic.RateLimitError,
                anthropic.InternalServerError,
                anthropic.APIConnectionError,
            ) as exc:
                last_exc = exc
                logger.warning(
                    "llm_retry attempt={}/{} error={}",
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

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                async with self._client.messages.stream(**kwargs) as stream:
                    if on_text_delta is not None:
                        async for text in stream.text_stream:
                            await on_text_delta(text)
                    response = await stream.get_final_message()
                return _parse_response(response)
            except (
                anthropic.RateLimitError,
                anthropic.InternalServerError,
                anthropic.APIConnectionError,
            ) as exc:
                last_exc = exc
                logger.warning(
                    "llm_retry attempt={}/{} error={}",
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                )
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(2**attempt)

        raise last_exc  # type: ignore[misc]
