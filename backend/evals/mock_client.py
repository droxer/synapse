"""Scripted LLM client and mock tool executor for deterministic evals."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from agent.llm.client import LLMResponse, TokenUsage, ToolCall
from agent.tools.base import ToolResult
from api.events import EventEmitter, EventType


def _build_llm_response(raw: dict[str, Any]) -> LLMResponse:
    """Convert a raw dict (from YAML mock_responses) into an LLMResponse."""
    tool_calls_raw = raw.get("tool_calls", [])
    tool_calls = tuple(
        ToolCall(
            id=tc.get("id", f"tc_{i}"),
            name=tc["name"],
            input=tc.get("input", {}),
        )
        for i, tc in enumerate(tool_calls_raw)
    )

    usage_raw = raw.get("usage", {})
    usage = TokenUsage(
        input_tokens=usage_raw.get("input_tokens", 100),
        output_tokens=usage_raw.get("output_tokens", 50),
    )

    return LLMResponse(
        text=raw.get("text", ""),
        tool_calls=tool_calls,
        stop_reason=raw.get("stop_reason", "end_turn"),
        usage=usage,
        thinking=raw.get("thinking", ""),
    )


_FALLBACK_RESPONSE = LLMResponse(
    text="Task complete.",
    tool_calls=(),
    stop_reason="end_turn",
    usage=TokenUsage(input_tokens=10, output_tokens=5),
)


class ScriptedLLMClient:
    """Duck-types AnthropicClient, returning pre-defined responses in sequence.

    When all scripted responses are exhausted, returns a fallback end_turn response.
    """

    def __init__(self, responses: tuple[LLMResponse, ...]) -> None:
        self._responses = list(responses)
        self._index = 0

    @classmethod
    def from_raw(cls, raw_responses: tuple[dict[str, Any], ...]) -> ScriptedLLMClient:
        """Create from raw dicts (as parsed from YAML mock_responses)."""
        parsed = tuple(_build_llm_response(r) for r in raw_responses)
        return cls(parsed)

    async def create_message_stream(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        on_text_delta: Callable[[str], Coroutine[Any, Any, None]] | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        """Return the next scripted response, or a fallback."""
        if self._index < len(self._responses):
            response = self._responses[self._index]
            self._index += 1
        else:
            response = _FALLBACK_RESPONSE

        if on_text_delta is not None and response.text:
            await on_text_delta(response.text)

        return response

    async def create_message(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        """Non-streaming variant — same sequencing logic."""
        if self._index < len(self._responses):
            response = self._responses[self._index]
            self._index += 1
        else:
            response = _FALLBACK_RESPONSE
        return response


class MockToolExecutor:
    """Returns successful mock output for all tool calls.

    Used in mock mode where we don't need real sandbox execution.
    """

    def __init__(self, emitter: EventEmitter | None = None) -> None:
        self._emitter = emitter
        self._spawn_count = 0
        self._handoff_count = 0

    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> ToolResult:
        """Return a generic success result."""
        if self._emitter is not None:
            if tool_name == "activate_skill":
                skill_name = tool_input.get("name")
                if isinstance(skill_name, str) and skill_name:
                    await self._emitter.emit(
                        EventType.SKILL_ACTIVATED,
                        {"name": skill_name, "source": "explicit"},
                    )
            elif tool_name == "agent_spawn":
                self._spawn_count += 1
                task = tool_input.get("task_description")
                task_text = task if isinstance(task, str) else ""
                agent_id = f"mock-agent-{self._spawn_count}"
                await self._emitter.emit(
                    EventType.AGENT_SPAWN,
                    {
                        "agent_id": agent_id,
                        "task": task_text,
                        "description": task_text,
                    },
                )
                return ToolResult.ok(
                    f"[mock] {tool_name} executed successfully",
                    metadata={"agent_id": agent_id},
                )
            elif tool_name == "agent_handoff":
                self._handoff_count += 1
                target_role = tool_input.get("target_role")
                if not isinstance(target_role, str):
                    target_role = ""
                reason = tool_input.get("context")
                if not isinstance(reason, str):
                    reason = str(tool_input.get("task_description", ""))
                await self._emitter.emit(
                    EventType.AGENT_HANDOFF,
                    {
                        "source_agent_id": f"mock-agent-handoff-{self._handoff_count}",
                        "target_role": target_role,
                        "reason": reason,
                        "handoff_depth": 1,
                    },
                )
        return ToolResult.ok(f"[mock] {tool_name} executed successfully")

    def reset_sandbox_template(self) -> None:
        """No-op for mock executor."""

    def reset_turn_quotas(self) -> None:
        """No-op; matches ToolExecutor API for turn boundaries."""

    def set_sandbox_template(self, template: str) -> None:
        """No-op for mock executor."""

    async def cleanup(self) -> None:
        """No-op for mock executor."""
