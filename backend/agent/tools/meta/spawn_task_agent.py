"""Meta-tool for spawning task agents from the planner."""

from __future__ import annotations

from typing import Any, cast

from loguru import logger

from agent.runtime.task_runner import ensure_task_agent_name_suffix
from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)
from agent.tools.meta.planner_state import PlannerState
from api.events import EventEmitter, EventType

_REDUNDANT_TASK_REJECTION = "Redundant task agent rejected"


class SpawnTaskAgent(LocalTool):
    """Spawn a new task agent to handle a focused sub-task."""

    def __init__(
        self,
        sub_agent_manager: Any,
        event_emitter: EventEmitter | None = None,
        planner_state: PlannerState | None = None,
    ) -> None:
        if sub_agent_manager is None:
            raise ValueError("SubAgentManager must not be None")
        self._manager = sub_agent_manager
        self._emitter = event_emitter
        self._planner_state = planner_state or PlannerState()

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
                    "deliverable": {
                        "type": "string",
                        "description": "Concrete output the worker must return to the planner.",
                    },
                    "ownership_scope": {
                        "type": "string",
                        "description": (
                            "The files, modules, research slice, data subset, or "
                            "responsibility boundary owned by this worker."
                        ),
                    },
                    "independence_reason": {
                        "type": "string",
                        "description": (
                            "Why this worker can proceed independently and why "
                            "delegation is useful for this task."
                        ),
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
                "required": [
                    "task_description",
                    "name",
                    "deliverable",
                    "ownership_scope",
                    "independence_reason",
                ],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("meta", "agent"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task_description = str(kwargs.get("task_description", ""))
        name = str(kwargs.get("name", ""))
        context = str(kwargs.get("context", ""))
        deliverable = str(kwargs.get("deliverable", ""))
        ownership_scope = str(kwargs.get("ownership_scope", ""))
        independence_reason = str(kwargs.get("independence_reason", ""))
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
        if error := self._planner_state.validate_spawn(name):
            return ToolResult.fail(error)
        if not deliverable.strip():
            return ToolResult.fail("deliverable must not be empty")
        if not ownership_scope.strip():
            return ToolResult.fail("ownership_scope must not be empty")
        if not independence_reason.strip():
            return ToolResult.fail("independence_reason must not be empty")
        display_name = ensure_task_agent_name_suffix(name)
        if existing_agent_id := self._planner_state.spawned_agent_id(name):
            logger.info(
                "spawn_task_agent_reused_existing step_name={} agent_id={}",
                name,
                existing_agent_id,
            )
            return ToolResult.ok(
                f"Agent already spawned with id: {existing_agent_id}",
                metadata={"agent_id": existing_agent_id},
            )
        if error := self._planner_state.validate_new_spawn():
            return ToolResult.fail(error)

        config: TaskAgentConfig
        try:
            from agent.runtime.task_runner import DependencyFailureMode, TaskAgentConfig
            from config.settings import get_settings

            model = get_settings().LITE_MODEL if use_lite_model else None
            worker_contract = (
                "Worker contract:\n"
                f"- Deliverable: {deliverable.strip()}\n"
                f"- Ownership scope: {ownership_scope.strip()}\n"
                f"- Independence reason: {independence_reason.strip()}"
            )
            full_context = "\n\n".join(
                part for part in (worker_contract, context.strip()) if part
            )

            config = TaskAgentConfig(
                task_description=task_description,
                name=display_name,
                context=full_context,
                sandbox_template=sandbox_template,
                depends_on=tuple(depends_on),
                model=model,
                timeout_seconds=timeout_seconds,
                role=role,
                dependency_failure_mode=dependency_failure_mode,
                allow_redundant=allow_redundant,
            )
            agent_id = await self._manager.spawn(config)
        except RuntimeError as exc:
            if str(exc).startswith(_REDUNDANT_TASK_REJECTION):
                redundant_agent_id = self._redundant_active_agent_id(config)
                if redundant_agent_id is not None:
                    logger.info(
                        "spawn_task_agent_reused_redundant name={} agent_id={}",
                        name,
                        redundant_agent_id,
                    )
                    self._planner_state.record_spawn(name, redundant_agent_id)
                    return ToolResult.ok(
                        f"Agent already spawned with id: {redundant_agent_id}",
                        metadata={"agent_id": redundant_agent_id},
                    )
                logger.info("spawn_task_agent_rejected reason=redundant_task")
                return ToolResult.fail(str(exc))
            logger.warning("spawn_task_agent_failed error={}", exc)
            return ToolResult.fail(f"Failed to spawn agent: {exc}")
        except Exception as exc:
            logger.warning("spawn_task_agent_failed error={}", exc)
            return ToolResult.fail(f"Failed to spawn agent: {exc}")

        # Emit AGENT_SPAWN immediately so the frontend can update the plan
        # checklist without waiting for the async task to acquire the semaphore.
        self._planner_state.record_spawn(name, agent_id)
        if self._emitter is not None:
            await self._emitter.emit(
                EventType.AGENT_SPAWN,
                {
                    "agent_id": agent_id,
                    "name": display_name,
                    "description": task_description,
                    "task": task_description,
                },
            )

        return ToolResult.ok(
            f"Agent spawned with id: {agent_id}",
            metadata={"agent_id": agent_id},
        )

    def _redundant_active_agent_id(self, config: Any) -> str | None:
        lookup = getattr(self._manager, "redundant_active_agent_id", None)
        if not callable(lookup):
            return None
        agent_id = lookup(config)
        return agent_id if isinstance(agent_id, str) and agent_id else None
