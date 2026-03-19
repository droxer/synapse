"""Meta-tool for spawning task agents from the planner."""

from __future__ import annotations

from typing import Any

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)


class SpawnTaskAgent(LocalTool):
    """Spawn a new task agent to handle a focused sub-task."""

    def __init__(self, sub_agent_manager: Any) -> None:
        if sub_agent_manager is None:
            raise ValueError("SubAgentManager must not be None")
        self._manager = sub_agent_manager

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_spawn",
            description=(
                "Spawn a new task agent to execute a focused sub-task. "
                "Returns an agent_id that can be passed to agent_wait."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "task_description": {
                        "type": "string",
                        "description": "Clear description of what the agent should accomplish.",
                    },
                    "context": {
                        "type": "string",
                        "description": "Additional context or instructions for the agent.",
                        "default": "",
                    },
                    "sandbox_template": {
                        "type": "string",
                        "description": "Sandbox template: 'default', 'data_science', or 'browser'.",
                        "default": "default",
                    },
                    "depends_on": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Agent IDs that must complete before this agent starts.",
                        "default": [],
                    },
                    "use_lite_model": {
                        "type": "boolean",
                        "description": "Use the lite (faster/cheaper) model for this task. Good for simple, focused tasks.",
                        "default": False,
                    },
                    "role": {
                        "type": "string",
                        "description": (
                            "Specialization role for the agent (e.g., "
                            "'researcher', 'coder', 'reviewer', "
                            "'data_analyst'). Affects the agent's "
                            "system prompt."
                        ),
                        "default": "",
                    },
                },
                "required": ["task_description"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task_description: str = kwargs.get("task_description", "")
        context: str = kwargs.get("context", "")
        sandbox_template: str = kwargs.get("sandbox_template", "default")
        depends_on: list[str] = kwargs.get("depends_on", [])
        use_lite_model: bool = kwargs.get("use_lite_model", False)
        role: str = kwargs.get("role", "")

        if not task_description.strip():
            return ToolResult.fail("task_description must not be empty")

        try:
            from agent.runtime.task_runner import TaskAgentConfig
            from config.settings import get_settings

            model = get_settings().LITE_MODEL if use_lite_model else None

            config = TaskAgentConfig(
                task_description=task_description,
                context=context,
                sandbox_template=sandbox_template,
                depends_on=tuple(depends_on),
                model=model,
                role=role,
            )
            agent_id = await self._manager.spawn(config)
        except Exception as exc:
            logger.warning("spawn_task_agent_failed error={}", exc)
            return ToolResult.fail(f"Failed to spawn agent: {exc}")

        return ToolResult.ok(
            f"Agent spawned with id: {agent_id}",
            metadata={"agent_id": agent_id},
        )
