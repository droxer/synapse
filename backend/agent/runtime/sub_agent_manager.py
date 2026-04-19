"""Sub-agent manager for spawning and tracking concurrent task agents."""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import asdict, dataclass, replace
from typing import Callable

from agent.llm.client import AnthropicClient
from agent.memory.store import PersistentMemoryStore
from agent.runtime.task_runner import (
    AgentResult,
    AgentRunMetrics,
    HandoffRequest,
    TaskAgentConfig,
    TaskAgentPromptTemplate,
    TaskAgentRunner,
    TASK_AGENT_PROMPT_TEMPLATE,
    ensure_task_agent_name_suffix,
)
from agent.skills.loader import SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.local.memory_list import MemoryList
from agent.tools.local.memory_recall import MemoryRecall
from agent.tools.local.memory_store import MemoryStore
from agent.tools.local.task_complete import TaskComplete
from agent.tools.meta.handoff import AgentHandoff
from agent.tools.meta.send_message import (
    AgentMessageBus,
    ReceiveMessages,
    SendToAgent,
)
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from config.settings import get_settings
from loguru import logger

# Type aliases for factory callables
ToolRegistryFactory = Callable[[], ToolRegistry]
ToolExecutorFactory = Callable[[ToolRegistry], ToolExecutor]

_FAILURE_MODE_PRIORITY: dict[str, int] = {
    "degrade": 0,
    "cancel_downstream": 1,
    "replan": 2,
}


@dataclass(frozen=True)
class TaskAgentSharedBundle:
    """Shared immutable task-agent prompt/tool bundle."""

    prompt_template: TaskAgentPromptTemplate
    tools: list[dict[str, object]]
    tools_fingerprint: str


class AgentWaitCancelled(RuntimeError):
    """Raised when a wait-for-agents call is interrupted by cancellation."""


def _normalize_task_signature(value: str) -> str:
    compact = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", compact)


def _aggregate_metrics(
    stage_metrics: list[AgentRunMetrics],
) -> AgentRunMetrics | None:
    if not stage_metrics:
        return None
    return AgentRunMetrics(
        duration_seconds=sum(m.duration_seconds for m in stage_metrics),
        iterations=sum(m.iterations for m in stage_metrics),
        tool_call_count=sum(m.tool_call_count for m in stage_metrics),
        context_compaction_count=sum(m.context_compaction_count for m in stage_metrics),
        input_tokens=sum(m.input_tokens for m in stage_metrics),
        output_tokens=sum(m.output_tokens for m in stage_metrics),
    )


def _format_handoff_context(
    source_messages: tuple[dict, ...],
    handoff_context: str,
    source_role: str,
    *,
    max_message_chars: int,
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
            parts.append(f"  [{role}]: {content[:max_message_chars]}")

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
        skill_registry: SkillRegistry | None = None,
        persistent_store: PersistentMemoryStore | None = None,
        memory_entries: list[dict[str, str]] | None = None,
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
        self._skill_registry = skill_registry
        self._persistent_store = persistent_store
        self._memory_entries = list(memory_entries or [])

        self._message_bus = AgentMessageBus()
        self._agents: dict[str, asyncio.Task[AgentResult]] = {}
        self._results: dict[str, AgentResult] = {}
        self._configs: dict[str, TaskAgentConfig] = {}
        self._executors: dict[str, list[ToolExecutor]] = {}
        self._agent_memory_stores: dict[str, dict[str, str]] = {}
        self._terminal_events_emitted: set[str] = set()
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._shared_bundle = self._build_shared_bundle()

    def _attach_memory_tools(
        self,
        registry: ToolRegistry,
        *,
        agent_id: str,
    ) -> ToolRegistry:
        """Attach memory tools backed by shared per-agent fallback storage."""
        fallback_store = self._agent_memory_stores.setdefault(agent_id, {})
        registry = registry.replace_tool(
            MemoryStore(
                store=fallback_store,
                persistent_store=self._persistent_store,
            )
        )
        registry = registry.replace_tool(
            MemoryRecall(
                store=fallback_store,
                persistent_store=self._persistent_store,
            )
        )
        registry = registry.replace_tool(
            MemoryList(
                store=fallback_store,
                persistent_store=self._persistent_store,
            )
        )
        return registry

    def _build_shared_bundle(self) -> TaskAgentSharedBundle:
        """Precompute shared task-agent prompt/tool payloads once per manager."""
        registry = self._attach_memory_tools(
            self._registry_factory(),
            agent_id="template",
        )

        async def _noop_complete(summary: str) -> None:
            del summary

        async def _noop_handoff(request: HandoffRequest) -> None:
            del request

        registry = registry.register(
            SendToAgent(
                self._message_bus,
                sender_id="template",
                target_validator=lambda agent_id: bool(agent_id),
            )
        )
        registry = registry.register(
            ReceiveMessages(self._message_bus, receiver_id="template")
        )
        registry = registry.register(TaskComplete(on_complete=_noop_complete))
        registry = registry.register(
            AgentHandoff(
                on_handoff=_noop_handoff,
                max_handoffs=3,
            )
        )
        cache_breakpoint = getattr(get_settings(), "PROMPT_CACHE_ENABLED", False)

        return TaskAgentSharedBundle(
            prompt_template=TASK_AGENT_PROMPT_TEMPLATE,
            tools=registry.to_anthropic_tools(cache_breakpoint=cache_breakpoint),
            tools_fingerprint=registry.anthropic_tools_fingerprint(),
        )

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

        normalized_name = ensure_task_agent_name_suffix(config.name)
        if normalized_name != config.name:
            config = replace(config, name=normalized_name)

        unknown_dependencies = sorted(
            dep_id for dep_id in config.depends_on if dep_id not in self._configs
        )
        if unknown_dependencies:
            unknown = ", ".join(unknown_dependencies)
            raise RuntimeError(f"Unknown dependency agent_id(s): {unknown}")

        settings = get_settings()
        if settings.AGENT_GLOBAL_TOKEN_BUDGET > 0:
            total_tokens = sum(
                r.metrics.input_tokens + r.metrics.output_tokens
                for r in self._results.values()
                if r.metrics is not None
            )
            if total_tokens >= settings.AGENT_GLOBAL_TOKEN_BUDGET:
                raise RuntimeError(
                    "Global agent token budget exceeded "
                    f"({total_tokens} >= {settings.AGENT_GLOBAL_TOKEN_BUDGET}); "
                    "refuse spawning further task agents",
                )

        if not config.allow_redundant:
            new_signature = _normalize_task_signature(config.task_description)
            for existing_id, existing in self._configs.items():
                if existing_id in self._results:
                    continue
                same_role = existing.role.strip().lower() == config.role.strip().lower()
                same_task = (
                    _normalize_task_signature(existing.task_description)
                    == new_signature
                )
                if same_role and same_task:
                    raise RuntimeError(
                        "Redundant task agent rejected; use allow_redundant=True for explicit voting/redundancy patterns"
                    )

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
        cancel_check: Callable[[], bool] | None = None,
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

        pending = dict(tasks_to_await)
        while pending:
            if cancel_check is not None and cancel_check():
                raise AgentWaitCancelled("agent_wait cancelled")

            done, _ = await asyncio.wait(
                pending.values(),
                timeout=0.05,
                return_when=asyncio.FIRST_COMPLETED,
            )

            for agent_id, task in list(pending.items()):
                if task in done or task.done():
                    self._synthesize_result_for_finished_task(agent_id)
                    pending.pop(agent_id, None)

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

        for agent_id, config in list(self._configs.items()):
            result = self._synthesize_result_for_finished_task(
                agent_id,
                default_error="Task agent was cancelled.",
            )
            if result is not None:
                await self._emit_terminal_events(agent_id, config, result)

        # Clean up executor sandbox sessions
        for agent_id, executors in self._executors.items():
            for executor in executors:
                try:
                    maybe_cleanup = executor.cleanup()
                    if asyncio.iscoroutine(maybe_cleanup):
                        await maybe_cleanup
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
        self._agent_memory_stores.clear()
        self._terminal_events_emitted.clear()
        self._message_bus.clear()

    def _is_agent_active(self, agent_id: str) -> bool:
        task = self._agents.get(agent_id)
        return task is not None and not task.done()

    async def _emit_terminal_events(
        self,
        agent_id: str,
        config: TaskAgentConfig,
        result: AgentResult,
    ) -> None:
        if agent_id in self._terminal_events_emitted:
            return
        self._terminal_events_emitted.add(agent_id)

        terminal_state = (
            "replan_required"
            if result.replan_required
            else "skipped"
            if result.skip_execution
            else "complete"
            if result.success
            else "error"
        )
        base_payload = {
            "agent_id": agent_id,
            "agent_name": config.name or agent_id,
            "error": result.error,
            "failure_mode": result.failure_mode,
            "metrics": asdict(result.metrics) if result.metrics is not None else None,
            "terminal_state": terminal_state,
        }
        if result.skip_execution:
            await self._emitter.emit(EventType.AGENT_SKIPPED, base_payload)
        if result.replan_required:
            await self._emitter.emit(EventType.AGENT_REPLAN_REQUIRED, base_payload)
        await self._emitter.emit(
            EventType.AGENT_COMPLETE,
            {
                **base_payload,
                "success": result.success,
                "timed_out": bool(result.error and "timed out" in result.error.lower()),
                "timeout_seconds": config.timeout_seconds,
                "completed_via_task_complete": result.completed_via_task_complete,
            },
        )

    def _synthesize_result_for_finished_task(
        self,
        agent_id: str,
        *,
        default_error: str = "Task agent terminated unexpectedly.",
    ) -> AgentResult | None:
        existing = self._results.get(agent_id)
        if existing is not None:
            return existing

        task = self._agents.get(agent_id)
        if task is None or not task.done():
            return None

        if task.cancelled():
            result = AgentResult(
                agent_id=agent_id,
                success=False,
                summary="",
                error=default_error,
            )
        else:
            try:
                task_result = task.result()
            except Exception as exc:
                result = AgentResult(
                    agent_id=agent_id,
                    success=False,
                    summary="",
                    error=str(exc) or default_error,
                )
            else:
                result = task_result

        self._results[agent_id] = result
        return result

    async def _run_agent(
        self,
        agent_id: str,
        config: TaskAgentConfig,
    ) -> AgentResult:
        """Run a task agent with dependency, concurrency, and handoff handling."""
        dep_outcome = await self._wait_for_dependencies(agent_id, config)

        if isinstance(dep_outcome, AgentResult):
            # Dependency policy says skip or replan — store and return early
            final_result = replace(
                dep_outcome,
                metrics=_aggregate_metrics(
                    [dep_outcome.metrics] if dep_outcome.metrics is not None else []
                ),
            )
            self._results[agent_id] = final_result
            await self._emit_terminal_events(agent_id, config, final_result)
            return final_result

        current_config = dep_outcome
        handoff_depth = 0
        stage_metrics: list[AgentRunMetrics] = []
        stage_artifacts: list[str] = []

        await self._emitter.emit(
            EventType.AGENT_START,
            {
                "agent_id": agent_id,
                "agent_name": current_config.name or agent_id,
                "task": current_config.task_description,
                "role": current_config.role,
            },
        )

        while True:
            async with self._semaphore:
                result = await self._execute_agent(agent_id, current_config)
            if result.metrics is not None:
                stage_metrics.append(result.metrics)
            for artifact_id in result.artifacts:
                if artifact_id not in stage_artifacts:
                    stage_artifacts.append(artifact_id)

            if result.handoff is None:
                final_result = replace(
                    result,
                    artifacts=tuple(stage_artifacts),
                    metrics=_aggregate_metrics(stage_metrics),
                )
                self._results[agent_id] = final_result
                await self._emit_terminal_events(agent_id, current_config, final_result)
                return final_result

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
            await self._emitter.emit(
                EventType.AGENT_STAGE_TRANSITION,
                {
                    "agent_id": agent_id,
                    "agent_name": current_config.name or agent_id,
                    "from_role": current_config.role,
                    "to_role": handoff.target_role,
                    "task": handoff.task_description,
                    "reason": handoff.context,
                    "stage_index": handoff_depth + 1,
                },
            )

            handoff_context = _format_handoff_context(
                handoff.source_messages,
                handoff.context,
                current_config.role,
                max_message_chars=get_settings().HANDOFF_MESSAGE_SNIPPET_CHARS,
            )
            merged_context = "\n\n".join(
                part for part in (current_config.context, handoff_context) if part
            )

            current_config = TaskAgentConfig(
                task_description=handoff.task_description,
                name=current_config.name,
                context=merged_context,
                sandbox_template=current_config.sandbox_template,
                priority=current_config.priority,
                depends_on=(),
                model=current_config.model,
                timeout_seconds=current_config.timeout_seconds,
                role=handoff.target_role,
                max_handoffs=handoff.remaining_handoffs,
                dependency_failure_mode=current_config.dependency_failure_mode,
                allow_redundant=current_config.allow_redundant,
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
                synthesized = self._synthesize_result_for_finished_task(
                    dep_id,
                    default_error="dependency terminated unexpectedly",
                )
                if synthesized is not None:
                    self._results[dep_id] = synthesized

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
            name=config.name,
            context=merged_context,
            sandbox_template=config.sandbox_template,
            priority=config.priority,
            depends_on=config.depends_on,
            model=config.model,
            timeout_seconds=config.timeout_seconds,
            role=config.role,
            max_handoffs=config.max_handoffs,
            dependency_failure_mode=config.dependency_failure_mode,
            allow_redundant=config.allow_redundant,
        )

    async def _execute_agent(
        self,
        agent_id: str,
        config: TaskAgentConfig,
    ) -> AgentResult:
        """Create and run a TaskAgentRunner, handling errors."""
        executor: ToolExecutor | None = None
        try:
            registry = self._attach_memory_tools(
                self._registry_factory(),
                agent_id=agent_id,
            )

            # Inject messaging tools for inter-agent communication
            registry = registry.register(
                SendToAgent(
                    self._message_bus,
                    sender_id=agent_id,
                    target_validator=self._is_agent_active,
                )
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
            self._executors.setdefault(agent_id, []).append(executor)

            runner = TaskAgentRunner(
                agent_id=agent_id,
                config=config,
                claude_client=self._client,
                tool_registry=registry,
                tool_executor=executor,
                event_emitter=self._emitter,
                max_iterations=self._max_iterations,
                skill_registry=self._skill_registry,
                prompt_template=self._shared_bundle.prompt_template,
                memory_entries=self._memory_entries,
                shared_tools=self._shared_bundle.tools,
                shared_tools_fingerprint=self._shared_bundle.tools_fingerprint,
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
        finally:
            if executor is not None:
                try:
                    maybe_cleanup = executor.cleanup()
                    if asyncio.iscoroutine(maybe_cleanup):
                        await maybe_cleanup
                except Exception as exc:
                    logger.error(
                        "Failed to cleanup executor for agent {}: {}",
                        agent_id[:8],
                        exc,
                    )
                executors = self._executors.get(agent_id, [])
                self._executors[agent_id] = [e for e in executors if e is not executor]
                if not self._executors[agent_id]:
                    self._executors.pop(agent_id, None)


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
