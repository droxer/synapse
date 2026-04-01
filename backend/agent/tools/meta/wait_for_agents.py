"""Meta-tool for waiting on task agent results."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)


class WaitForAgents(LocalTool):
    """Wait for one or more task agents to complete and return their results."""

    def __init__(self, sub_agent_manager: Any) -> None:
        if sub_agent_manager is None:
            raise ValueError("SubAgentManager must not be None")
        self._manager = sub_agent_manager

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_wait",
            description=(
                "Wait for task agents to complete. "
                "If agent_ids is empty, waits for all running agents."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "agent_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of agent IDs to wait for. Empty = wait for all.",
                        "default": [],
                    },
                },
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        agent_ids: list[str] = kwargs.get("agent_ids", [])

        try:
            results = await self._manager.wait(
                agent_ids if agent_ids else None,
            )
        except Exception as exc:
            logger.warning("wait_for_agents_failed error={}", exc)
            return ToolResult.fail(f"Failed waiting for agents: {exc}")

        summaries = {
            aid: {
                "success": result.success,
                "summary": result.summary,
                "error": result.error,
                "artifacts": list(result.artifacts),
                "failure_mode": result.failure_mode,
                "metrics": (
                    asdict(result.metrics) if result.metrics is not None else None
                ),
            }
            for aid, result in results.items()
        }

        return ToolResult.ok(
            json.dumps(summaries, ensure_ascii=False),
            metadata={"agent_count": len(summaries)},
        )
