"""Meta-tool for spawning task agents from the planner."""

from __future__ import annotations

from typing import Any, cast

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)
from api.events import EventEmitter, EventType


class SpawnTaskAgent(LocalTool):
    """Spawn a new task agent to handle a focused sub-task."""

    def __init__(
        self,
        sub_agent_manager: Any,
        event_emitter: EventEmitter | None = None,
    ) -> None:
        if sub_agent_manager is None:
            raise ValueError("SubAgentManager must not be None")
        self._manager = sub_agent_manager
        self._emitter = event_emitter

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
                    "name": {
                        "type": "string",
                        "description": "Short user-friendly label for this task (3-5 words, shown in the UI).",
                        "default": "",
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
                    "timeout_seconds": {
                        "type": "number",
                        "description": "Optional per-agent timeout in seconds. Overrides global task agent timeout for this spawned agent.",
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
                    "dependency_failure_mode": {
                        "type": "string",
                        "enum": [
                            "inherit",
                            "cancel_downstream",
                            "degrade",
                            "replan",
                        ],
                        "description": (
                            "How to handle failure of dependency agents: "
                            "omit or use 'inherit' to use failed dependency mode, "
                            "'cancel_downstream' skips this agent, "
                            "'degrade' continues with failure context, "
                            "'replan' flags for replanning."
                        ),
                        "default": "inherit",
                    },
                    "allow_redundant": {
                        "type": "boolean",
                        "description": (
                            "Allow this spawn even if it overlaps an existing worker task. "
                            "Use for explicit voting/redundancy patterns."
                        ),
                        "default": False,
                    },
                },
                "required": ["task_description", "name"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task_description: str = kwargs.get("task_description", "")
        name: str = kwargs.get("name", "")
        context: str = kwargs.get("context", "")
        sandbox_template: str = kwargs.get("sandbox_template", "default")
        depends_on: list[str] = kwargs.get("depends_on", [])
        use_lite_model: bool = kwargs.get("use_lite_model", False)
        timeout_seconds: float | None = kwargs.get("timeout_seconds")
        role: str = kwargs.get("role", "")
        allow_redundant: bool = kwargs.get("allow_redundant", False)
        dependency_failure_mode = cast(
            "DependencyFailureMode",
            kwargs.get("dependency_failure_mode", "inherit"),
        )

        if not task_description.strip():
            return ToolResult.fail("task_description must not be empty")

        try:
            from agent.runtime.task_runner import DependencyFailureMode, TaskAgentConfig
            from config.settings import get_settings

            model = get_settings().LITE_MODEL if use_lite_model else None

            config = TaskAgentConfig(
                task_description=task_description,
                name=name,
                context=context,
                sandbox_template=sandbox_template,
                depends_on=tuple(depends_on),
                model=model,
                timeout_seconds=timeout_seconds,
                role=role,
                dependency_failure_mode=dependency_failure_mode,
                allow_redundant=allow_redundant,
            )
            agent_id = await self._manager.spawn(config)
        except Exception as exc:
            logger.warning("spawn_task_agent_failed error={}", exc)
            return ToolResult.fail(f"Failed to spawn agent: {exc}")

        # Emit AGENT_SPAWN immediately so the frontend can update the plan
        # checklist without waiting for the async task to acquire the semaphore.
        if self._emitter is not None:
            await self._emitter.emit(
                EventType.AGENT_SPAWN,
                {
                    "agent_id": agent_id,
                    "name": name,
                    "description": task_description,
                    "task": task_description,
                },
            )

        return ToolResult.ok(
            f"Agent spawned with id: {agent_id}",
            metadata={"agent_id": agent_id},
        )
