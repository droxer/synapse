"""Meta-tool for declaring a plan before spawning agents."""

from __future__ import annotations

from typing import Any

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)
from api.events import EventEmitter, EventType


class PlanCreate(LocalTool):
    """Declare a structured plan with named steps before spawning agents."""

    def __init__(self, event_emitter: EventEmitter) -> None:
        self._emitter = event_emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="plan_create",
            description=(
                "Declare the plan before spawning agents. "
                "Call this FIRST with the list of steps you intend to execute, "
                "then spawn agents for each step."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Short user-friendly label (3-5 words).",
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Brief description of what this step does.",
                                },
                                "execution_type": {
                                    "type": "string",
                                    "enum": [
                                        "planner_owned",
                                        "sequential_worker",
                                        "parallel_worker",
                                    ],
                                    "description": (
                                        "How this step should execute: planner-owned synthesis/checkpoint work, "
                                        "a sequential worker task, or a parallel worker task."
                                    ),
                                    "default": "parallel_worker",
                                },
                            },
                            "required": ["name", "description"],
                        },
                        "description": "Ordered list of plan steps.",
                    },
                },
                "required": ["steps"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        steps: list[dict[str, str]] = kwargs.get("steps", [])

        if not steps:
            return ToolResult.fail("steps must not be empty")

        await self._emitter.emit(
            EventType.PLAN_CREATED,
            {
                "steps": [
                    {
                        "name": s.get("name", ""),
                        "description": s.get("description", ""),
                        "execution_type": s.get("execution_type", "parallel_worker"),
                    }
                    for s in steps
                ],
            },
        )

        step_names = [s.get("name", "") for s in steps]
        return ToolResult.ok(
            f"Plan created with {len(steps)} steps: {', '.join(step_names)}. "
            "Now spawn agents for each step."
        )
