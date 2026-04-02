"""Sub-agent manager for spawning and tracking concurrent task agents."""

from __future__ import annotations

import asyncio
import uuid
from typing import Callable

from agent.llm.client import AnthropicClient
from agent.runtime.task_runner import (
    AgentResult,
    HandoffRequest,
    TaskAgentConfig,
    TaskAgentRunner,
)
from agent.tools.executor import ToolExecutor
from agent.tools.local.task_complete import TaskComplete
from agent.tools.meta.handoff import AgentHandoff
from agent.tools.meta.send_message import (
    AgentMessageBus,
    ReceiveMessages,
    SendToAgent,
)
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from loguru import logger

# Type aliases for factory callables
ToolRegistryFactory = Callable[[], ToolRegistry]
ToolExecutorFactory = Callable[[ToolRegistry], ToolExecutor]

_FAILURE_MODE_PRIORITY: dict[str, int] = {
    "degrade": 0,
    "cancel_downstream": 1,
    "replan": 2,
}


def _format_handoff_context(
    source_messages: tuple[dict, ...],
    handoff_context: str,
    source_role: str,
) -> str:
    """Format the previous agent's conversation history for the new agent."""
    parts: list[str] = []
    parts.append(f"Handed off from agent with role: {source_role}")

    if source_messages:
        parts.append("\nPrevious conversation:")
        for msg in source_messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, list):
                text_parts = [
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ]
                content = "\n".join(text_parts)
            parts.append(f"  [{role}]: {content[:500]}")

    if handoff_context:
        parts.append(f"\nHandoff notes: {handoff_context}")

    return "\n".join(parts)


class SubAgentManager:
    """Manages spawning and tracking of concurrent task agents.

    Each spawned agent receives its own tool registry and executor
    via the provided factory callables, enabling per-agent sandbox
    isolation.
    """

    def __init__(
        self,
        claude_client: AnthropicClient,
        tool_registry_factory: ToolRegistryFactory,
        tool_executor_factory: ToolExecutorFactory,
        event_emitter: EventEmitter,
        max_concurrent: int = 5,
        max_total: int = 20,
        max_iterations: int = 50,
    ) -> None:
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be at least 1")
        if max_total < 1:
            raise ValueError("max_total must be at least 1")
        if max_iterations < 1:
            raise ValueError("max_iterations must be at least 1")

        self._client = claude_client
        self._registry_factory = tool_registry_factory
        self._executor_factory = tool_executor_factory
        self._emitter = event_emitter
        self._max_concurrent = max_concurrent
        self._max_total = max_total
        self._max_iterations = max_iterations

        self._message_bus = AgentMessageBus()
        self._agents: dict[str, asyncio.Task[AgentResult]] = {}
        self._results: dict[str, AgentResult] = {}
        self._configs: dict[str, TaskAgentConfig] = {}
        self._executors: dict[str, ToolExecutor] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent)

    @property
    def total_spawned(self) -> int:
        """Total number of agents spawned (running + completed)."""
        return len(self._configs)

    async def spawn(self, config: TaskAgentConfig) -> str:
        """Spawn a new task agent and return its agent_id.

        Raises:
            RuntimeError: If max_total limit has been reached.
        """
        if self.total_spawned >= self._max_total:
            raise RuntimeError(f"Maximum total agents reached ({self._max_total})")

        agent_id = str(uuid.uuid4())
        self._configs[agent_id] = config

        task = asyncio.create_task(
            self._run_agent(agent_id, config),
            name=f"task-agent-{agent_id[:8]}",
        )
        self._agents[agent_id] = task

        logger.info(
            "Spawned task agent %s: %s",
            agent_id[:8],
            config.task_description[:80],
        )
        return agent_id

    async def wait(
        self,
        agent_ids: list[str] | None = None,
    ) -> dict[str, AgentResult]:
        """Wait for specified agents (or all) and return their results.

        Args:
            agent_ids: Specific agent IDs to wait for. If None, waits
                for all currently running agents.

        Returns:
            Mapping of agent_id to AgentResult for each awaited agent.

        Raises:
            KeyError: If an unknown agent_id is provided.
        """
        ids_to_wait = agent_ids if agent_ids is not None else list(self._agents)

        tasks_to_await = _collect_tasks(ids_to_wait, self._agents, self._results)

        if tasks_to_await:
            await asyncio.gather(
                *tasks_to_await.values(),
                return_exceptions=True,
            )

        return _gather_results(ids_to_wait, self._results)

    async def cleanup(self) -> None:
        """Cancel all running agents and clean up resources."""
        for agent_id, task in self._agents.items():
            if not task.done():
                task.cancel()
                logger.info("Cancelled task agent {}", agent_id[:8])

        # Wait for cancellations to propagate
        if self._agents:
            await asyncio.gather(
                *self._agents.values(),
                return_exceptions=True,
            )

        # Clean up executor sandbox sessions
        for agent_id, executor in self._executors.items():
            try:
                await executor.cleanup()
            except Exception as exc:
                logger.error(
                    "Failed to cleanup executor for agent {}: {}",
                    agent_id[:8],
                    exc,
                )

        self._agents.clear()
        self._results.clear()
        self._configs.clear()
        self._executors.clear()
        self._message_bus.clear()

    async def _run_agent(
        self,
        agent_id: str,
        config: TaskAgentConfig,
    ) -> AgentResult:
        """Run a task agent with dependency, concurrency, and handoff handling."""
        dep_outcome = await self._wait_for_dependencies(agent_id, config)

        if isinstance(dep_outcome, AgentResult):
            # Dependency policy says skip or replan — store and return early
            self._results[agent_id] = dep_outcome
            return dep_outcome

        current_config = dep_outcome
        handoff_depth = 0

        while True:
            async with self._semaphore:
                result = await self._execute_agent(agent_id, current_config)

            if result.handoff is None:
                self._results[agent_id] = result
                return result

            handoff_depth += 1
            handoff = result.handoff

            await self._emitter.emit(
                EventType.AGENT_HANDOFF,
                {
                    "source_agent_id": agent_id,
                    "target_agent_id": agent_id,
                    "parent_agent_id": agent_id,
                    "target_role": handoff.target_role,
                    "reason": handoff.context,
                    "handoff_depth": handoff_depth,
                    "remaining_handoffs": handoff.remaining_handoffs,
                },
            )

            context = _format_handoff_context(
                handoff.source_messages,
                handoff.context,
                current_config.role,
            )

            current_config = TaskAgentConfig(
                task_description=handoff.task_description,
                context=context,
                sandbox_template=current_config.sandbox_template,
                priority=current_config.priority,
                depends_on=(),
                model=current_config.model,
                timeout_seconds=current_config.timeout_seconds,
                role=handoff.target_role,
                max_handoffs=handoff.remaining_handoffs,
                dependency_failure_mode=current_config.dependency_failure_mode,
            )

            logger.info(
                "Agent {} handoff #{} → role={} task={}",
                agent_id[:8],
                handoff_depth,
                handoff.target_role,
                handoff.task_description[:80],
            )

    async def _wait_for_dependencies(
        self,
        agent_id: str,
        config: TaskAgentConfig,
    ) -> TaskAgentConfig | AgentResult:
        """Block until all dependency agents have completed.

        Returns an updated config with dependency results prepended
        to the context field, or an AgentResult if the agent should
        be skipped / flagged for replan based on dependency_failure_mode.
        """
        if not config.depends_on:
            return config

        for dep_id in config.depends_on:
            dep_task = self._agents.get(dep_id)
            if dep_task is None:
                logger.warning(
                    "Agent {} depends on unknown agent {}",
                    agent_id[:8],
                    dep_id[:8],
                )
                continue
            if not dep_task.done():
                await asyncio.gather(dep_task, return_exceptions=True)

            if dep_id not in self._results and dep_task.done():
                logger.warning(
                    "Dependency agent {} finished without stored result; "
                    "synthesizing failure",
                    dep_id[:8],
                )
                self._results[dep_id] = AgentResult(
                    agent_id=dep_id,
                    success=False,
                    summary="",
                    error="dependency terminated unexpectedly",
                    failure_mode="cancel_downstream",
                )

        # Check for dependency failures and apply failure mode policy
        failed_deps: list[tuple[str, AgentResult]] = []
        for dep_id in config.depends_on:
            dep_result = self._results.get(dep_id)
            if dep_result is not None and not dep_result.success:
                failed_deps.append((dep_id, dep_result))

        effective_mode: str | None = None
        if failed_deps:
            configured_mode = config.dependency_failure_mode
            inherited_mode = max(
                (dep_result.failure_mode for _, dep_result in failed_deps),
                key=lambda mode: _FAILURE_MODE_PRIORITY[mode],
            )
            effective_mode = (
                inherited_mode if configured_mode == "inherit" else configured_mode
            )

            if effective_mode == "cancel_downstream":
                dep_errors = "; ".join(
                    f"{did[:8]}: {dr.error or '(no detail)'}" for did, dr in failed_deps
                )
                return AgentResult(
                    agent_id=agent_id,
                    success=False,
                    summary="",
                    error=f"Skipped: dependency failed ({dep_errors})",
                    failure_mode="cancel_downstream",
                    skip_execution=True,
                )

            if effective_mode == "replan":
                dep_errors = "; ".join(
                    f"{did[:8]}: {dr.error or '(no detail)'}" for did, dr in failed_deps
                )
                return AgentResult(
                    agent_id=agent_id,
                    success=False,
                    summary="",
                    error=f"Replan required: dependency failed ({dep_errors})",
                    failure_mode="replan",
                    replan_required=True,
                )

            # effective_mode == "degrade": fall through and inject failure context

        # Collect dependency results and add them as context
        dep_summaries: list[str] = []
        for dep_id in config.depends_on:
            dep_result = self._results.get(dep_id)
            if dep_result is None:
                continue
            status = "succeeded" if dep_result.success else "failed"
            summary = dep_result.summary or dep_result.error or "(no output)"
            dep_summaries.append(f"- Dependency {dep_id[:8]} ({status}): {summary}")

        # Add degraded dependency warning for degrade mode
        if failed_deps and effective_mode == "degrade":
            for dep_id, dep_result in failed_deps:
                dep_summaries.append(
                    f"- [DEGRADED] Dependency {dep_id[:8]} failed: "
                    f"{dep_result.error or '(no detail)'}. "
                    f"Proceeding in degraded mode."
                )

        if not dep_summaries:
            return config

        dep_context = "Results from dependency agents:\n" + "\n".join(dep_summaries)
        existing_context = config.context
        merged_context = (
            f"{dep_context}\n\n{existing_context}" if existing_context else dep_context
        )

        return TaskAgentConfig(
            task_description=config.task_description,
            context=merged_context,
            sandbox_template=config.sandbox_template,
            priority=config.priority,
            depends_on=config.depends_on,
            model=config.model,
            timeout_seconds=config.timeout_seconds,
            role=config.role,
            max_handoffs=config.max_handoffs,
            dependency_failure_mode=config.dependency_failure_mode,
        )

    async def _execute_agent(
        self,
        agent_id: str,
        config: TaskAgentConfig,
    ) -> AgentResult:
        """Create and run a TaskAgentRunner, handling errors."""
        try:
            registry = self._registry_factory()

            # Inject messaging tools for inter-agent communication
            registry = registry.register(
                SendToAgent(self._message_bus, sender_id=agent_id)
            )
            registry = registry.register(
                ReceiveMessages(self._message_bus, receiver_id=agent_id)
            )

            # Callback holder — routes task_complete calls to the runner
            # once it's created (same pattern as _CallbackHolder in builders.py)
            callback_target: list[TaskAgentRunner | None] = [None]

            async def _on_complete(summary: str) -> None:
                if callback_target[0] is not None:
                    await callback_target[0].on_task_complete(summary)

            registry = registry.register(TaskComplete(on_complete=_on_complete))

            # Handoff callback — routes agent_handoff calls to the runner
            handoff_target: list[TaskAgentRunner | None] = [None]

            async def _on_handoff(request: HandoffRequest) -> None:
                if handoff_target[0] is not None:
                    await handoff_target[0].on_handoff(request)

            registry = registry.register(
                AgentHandoff(
                    on_handoff=_on_handoff,
                    max_handoffs=config.max_handoffs,
                )
            )

            executor = self._executor_factory(registry)
            self._executors[agent_id] = executor

            runner = TaskAgentRunner(
                agent_id=agent_id,
                config=config,
                claude_client=self._client,
                tool_registry=registry,
                tool_executor=executor,
                event_emitter=self._emitter,
                max_iterations=self._max_iterations,
            )
            callback_target[0] = runner
            handoff_target[0] = runner

            return await runner.run()
        except Exception as exc:
            logger.exception("Agent {} execution failed: {}", agent_id[:8], exc)
            return AgentResult(
                agent_id=agent_id,
                success=False,
                summary="",
                error=str(exc),
            )


def _collect_tasks(
    ids: list[str],
    agents: dict[str, asyncio.Task[AgentResult]],
    results: dict[str, AgentResult],
) -> dict[str, asyncio.Task[AgentResult]]:
    """Collect asyncio.Task objects for agents that haven't completed yet."""
    tasks: dict[str, asyncio.Task[AgentResult]] = {}
    for agent_id in ids:
        if agent_id in results:
            continue
        if agent_id not in agents:
            raise KeyError(f"Unknown agent_id: {agent_id}")
        tasks[agent_id] = agents[agent_id]
    return tasks


def _gather_results(
    ids: list[str],
    results: dict[str, AgentResult],
) -> dict[str, AgentResult]:
    """Build the result dict for the requested agent IDs."""
    gathered: dict[str, AgentResult] = {}
    for agent_id in ids:
        result = results.get(agent_id)
        if result is not None:
            gathered[agent_id] = result
    return gathered
