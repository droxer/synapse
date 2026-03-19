"""Meta-tool for agent-initiated handoff to a specialist agent."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from loguru import logger

from agent.runtime.task_runner import HandoffRequest
from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)


class AgentHandoff(LocalTool):
    """Hand off the current task to a new specialist agent."""

    def __init__(
        self,
        on_handoff: Callable[[HandoffRequest], Coroutine[Any, Any, None]],
        max_handoffs: int = 3,
    ) -> None:
        if on_handoff is None:
            raise ValueError("Handoff callback must not be None")
        self._on_handoff = on_handoff
        self._max_handoffs = max_handoffs

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_handoff",
            description=(
                "Hand off your current task to a new specialist agent with a "
                "different role. Use this when you realize the task needs a "
                "different specialization (e.g., hand off from coder to "
                "reviewer). Your conversation history will be transferred."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "target_role": {
                        "type": "string",
                        "description": (
                            "The role for the new agent (e.g., 'reviewer', "
                            "'coder', 'researcher', 'data_analyst')."
                        ),
                    },
                    "task_description": {
                        "type": "string",
                        "description": "What the new agent should accomplish.",
                    },
                    "context": {
                        "type": "string",
                        "description": (
                            "Additional handoff notes — why you're handing "
                            "off and what the new agent should know."
                        ),
                        "default": "",
                    },
                },
                "required": ["target_role", "task_description"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent", "handoff"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        target_role: str = kwargs.get("target_role", "")
        task_description: str = kwargs.get("task_description", "")
        context: str = kwargs.get("context", "")

        if not target_role.strip():
            return ToolResult.fail("target_role must not be empty")
        if not task_description.strip():
            return ToolResult.fail("task_description must not be empty")
        if self._max_handoffs <= 0:
            return ToolResult.fail(
                "No handoffs remaining. Use task_complete instead."
            )

        request = HandoffRequest(
            target_role=target_role,
            task_description=task_description,
            context=context,
            source_messages=(),  # Populated by the runner
            remaining_handoffs=self._max_handoffs - 1,
        )

        try:
            await self._on_handoff(request)
        except Exception as exc:
            logger.warning("agent_handoff_failed error={}", exc)
            return ToolResult.fail(f"Handoff failed: {exc}")

        return ToolResult.ok(
            f"Handing off to {target_role} agent.",
            metadata={"target_role": target_role},
        )
