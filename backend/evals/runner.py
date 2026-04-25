"""Eval runner — wires orchestrator, runs cases, collects and grades results."""

from __future__ import annotations

import time
from typing import Any

from loguru import logger

from agent.llm.client import AnthropicClient
from agent.context.compaction import Observer
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.runtime.task_runner import AgentResult, TaskAgentConfig
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from agent.tools.executor import ToolExecutor
from agent.tools.local.task_complete import TaskComplete
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType

from evals.collector import EvalCollector
from evals.grader import grade_criteria
from evals.llm_judge import judge_with_llm
from evals.mock_client import ScriptedLLMClient
from evals.models import EvalCase, EvalReport, EvalResult


class _NoOpTaskComplete:
    """Minimal task_complete callback holder for eval orchestrator."""

    def __init__(self) -> None:
        self._callback: Any = None

    async def __call__(self, summary: str) -> None:
        if self._callback is not None:
            await self._callback(summary)

    def set(self, callback: Any) -> None:
        self._callback = callback


class _SimpleLocalTool:
    """Wraps a name + mock executor into a LocalTool for the registry."""

    def __init__(self, name: str, description: str) -> None:
        self._name = name
        self._description = description

    def definition(self) -> Any:
        from agent.tools.base import ExecutionContext, ToolDefinition

        return ToolDefinition(
            name=self._name,
            description=self._description,
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        del kwargs
        return ToolResult.ok(f"[mock] {self._name} executed")


class _MockActivateSkillTool(LocalTool):
    def __init__(self, emitter: EventEmitter) -> None:
        self._emitter = emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="activate_skill",
            description="Activate a skill for expert methodology",
            input_schema={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        skill_name = str(kwargs.get("name", "")).strip()
        if not skill_name:
            return ToolResult.fail("name must not be empty")
        await self._emitter.emit(
            EventType.SKILL_ACTIVATED,
            {"name": skill_name, "source": "explicit"},
        )
        return ToolResult.ok(f"[mock] activate_skill executed for {skill_name}")


class _MockAgentSpawnTool(LocalTool):
    def __init__(self, emitter: EventEmitter) -> None:
        self._emitter = emitter
        self._spawn_count = 0

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_spawn",
            description="Spawn a new task agent for a sub-task",
            input_schema={
                "type": "object",
                "properties": {
                    "task_description": {"type": "string"},
                    "name": {"type": "string"},
                    "deliverable": {"type": "string"},
                    "ownership_scope": {"type": "string"},
                    "independence_reason": {"type": "string"},
                },
                "required": [
                    "task_description",
                    "deliverable",
                    "ownership_scope",
                    "independence_reason",
                ],
            },
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        task = str(kwargs.get("task_description", "")).strip()
        if not task:
            return ToolResult.fail("task_description must not be empty")
        self._spawn_count += 1
        agent_id = f"mock-agent-{self._spawn_count}"
        await self._emitter.emit(
            EventType.AGENT_SPAWN,
            {
                "agent_id": agent_id,
                "task": task,
                "description": task,
            },
        )
        return ToolResult.ok(
            f"[mock] agent_spawn executed for {task}",
            metadata={"agent_id": agent_id},
        )


class _MockAgentHandoffTool(LocalTool):
    def __init__(self, emitter: EventEmitter) -> None:
        self._emitter = emitter
        self._handoff_count = 0

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="agent_handoff",
            description="Hand off to a specialist agent",
            input_schema={
                "type": "object",
                "properties": {
                    "target_role": {"type": "string"},
                    "context": {"type": "string"},
                    "task_description": {"type": "string"},
                },
                "required": ["target_role"],
            },
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        target_role = str(kwargs.get("target_role", "")).strip()
        if not target_role:
            return ToolResult.fail("target_role must not be empty")
        reason = str(
            kwargs.get("context") or kwargs.get("task_description") or ""
        ).strip()
        self._handoff_count += 1
        await self._emitter.emit(
            EventType.AGENT_HANDOFF,
            {
                "source_agent_id": f"mock-agent-handoff-{self._handoff_count}",
                "target_role": target_role,
                "reason": reason,
                "handoff_depth": 1,
            },
        )
        return ToolResult.ok(f"[mock] agent_handoff executed for {target_role}")


class _EvalSubAgentManager:
    """Minimal in-memory task-agent manager for planner evals."""

    def __init__(self) -> None:
        self._results: dict[str, AgentResult] = {}
        self._spawn_count = 0

    async def spawn(self, config: TaskAgentConfig) -> str:
        self._spawn_count += 1
        agent_id = f"mock-agent-{self._spawn_count}"
        self._results[agent_id] = AgentResult(
            agent_id=agent_id,
            success=True,
            summary=f"[mock] completed: {config.task_description}",
        )
        return agent_id

    async def wait(
        self,
        agent_ids: list[str] | None = None,
    ) -> dict[str, AgentResult]:
        ids_to_wait = agent_ids or list(self._results)
        missing = [
            agent_id for agent_id in ids_to_wait if agent_id not in self._results
        ]
        if missing:
            raise KeyError(", ".join(missing))
        return {agent_id: self._results[agent_id] for agent_id in ids_to_wait}

    async def cleanup(self) -> None:
        return None


def _build_mock_registry(
    *,
    emitter: EventEmitter,
    on_complete: _NoOpTaskComplete,
    planner_mode: bool,
) -> ToolRegistry:
    """Build a minimal tool registry for mock and live eval backends."""
    registry = ToolRegistry()
    generic_tools = [
        ("web_search", "Search the web for information"),
        ("web_fetch", "Fetch content from a URL"),
        ("code_run", "Run code in a sandbox"),
        ("code_interpret", "Interpret and execute Python code"),
        ("shell_exec", "Execute a shell command"),
        ("message_user", "Send a message to the user"),
    ]
    for name, desc in generic_tools:
        registry = registry.register(_SimpleLocalTool(name, desc))
    registry = registry.register(TaskComplete(on_complete))
    registry = registry.register(_MockActivateSkillTool(emitter))
    if not planner_mode:
        registry = registry.register(_MockAgentSpawnTool(emitter))
        registry = registry.register(
            _SimpleLocalTool("agent_wait", "Wait for task agents to complete")
        )
        registry = registry.register(_MockAgentHandoffTool(emitter))
    return registry


async def run_case(
    case: EvalCase,
    backend: str = "mock",
    live_client: AnthropicClient | None = None,
    judge_model: str = "claude-haiku-4-5-20251001",
) -> EvalResult:
    """Run a single eval case and return the graded result.

    Args:
        case: The eval case definition.
        backend: "mock" for scripted responses, "live" for real API calls.
        live_client: Required when backend="live".
        judge_model: Model to use for LLM-as-judge grading.
    """
    emitter = EventEmitter()
    collector = EvalCollector()
    emitter.subscribe(collector.on_event)

    try:
        on_complete = _NoOpTaskComplete()
        if backend == "mock":
            if case.mock_responses:
                client: Any = ScriptedLLMClient.from_raw(case.mock_responses)
            else:
                # Default: single end_turn response
                from agent.llm.client import LLMResponse, TokenUsage

                client = ScriptedLLMClient(
                    responses=(
                        LLMResponse(
                            text="I'll help with that task.",
                            tool_calls=(),
                            stop_reason="end_turn",
                            usage=TokenUsage(input_tokens=50, output_tokens=20),
                        ),
                    )
                )
            planner_mode = case.orchestrator_mode == "planner"
            registry = _build_mock_registry(
                emitter=emitter,
                on_complete=on_complete,
                planner_mode=planner_mode,
            )
            executor = ToolExecutor(registry=registry, event_emitter=emitter)
        elif backend == "live":
            if live_client is None:
                return _error_result(case, "live_client required for backend='live'")
            client = live_client
            planner_mode = case.orchestrator_mode == "planner"
            registry = _build_mock_registry(
                emitter=emitter,
                on_complete=on_complete,
                planner_mode=planner_mode,
            )
            executor = ToolExecutor(registry=registry, event_emitter=emitter)
        else:
            return _error_result(case, f"Unknown backend: {backend}")

        # Use custom token budget if specified in the eval case
        observer = None
        if case.token_budget > 0:
            observer = Observer(token_budget=case.token_budget)

        if planner_mode:
            orchestrator = PlannerOrchestrator(
                claude_client=client,
                tool_registry=registry,
                tool_executor=executor,
                event_emitter=emitter,
                sub_agent_manager=_EvalSubAgentManager(),
                system_prompt="You are a helpful planning assistant being evaluated. Use the available tools to decompose work and coordinate task agents when needed.",
                max_iterations=case.max_iterations,
                observer=observer,
            )
        else:
            orchestrator = AgentOrchestrator(
                claude_client=client,
                tool_registry=registry,
                tool_executor=executor,
                event_emitter=emitter,
                system_prompt="You are a helpful assistant being evaluated. Use the available tools to complete the task.",
                max_iterations=case.max_iterations,
                observer=observer,
            )
        on_complete.set(orchestrator.on_task_complete)

        execution_shape = "orchestrator_workers" if planner_mode else "single_agent"
        execution_rationale = (
            "eval configured explicit planner mode"
            if planner_mode and case.explicit_planner
            else "eval configured planner mode"
            if planner_mode
            else "eval configured single agent mode"
        )
        if planner_mode and not case.explicit_planner:
            await emitter.emit(EventType.PLANNER_AUTO_SELECTED, {})

        await orchestrator.run(
            case.user_message,
            turn_metadata={
                "execution_shape": execution_shape,
                "execution_rationale": execution_rationale,
                "explicit_planner": case.explicit_planner,
            },
        )

    except Exception as exc:
        logger.error("Eval case '{}' raised: {}", case.id, exc)
        return _error_result(case, str(exc))

    metrics = collector.to_metrics()

    # Grade
    criterion_results_list: list[Any] = []
    programmatic_score = 0.0
    judge_score = 0.0
    judge_passed = False

    if case.grading_mode in ("programmatic", "both"):
        programmatic_results, programmatic_score = grade_criteria(
            case.criteria, metrics
        )
        criterion_results_list.extend(programmatic_results)

    if case.grading_mode in ("llm_judge", "both"):
        if live_client is not None:
            judge_outcome = await judge_with_llm(
                case, metrics, live_client, model=judge_model
            )
            criterion_results_list.append(judge_outcome.result)
            judge_score = judge_outcome.score
            judge_passed = judge_outcome.result.passed
        else:
            criterion_results_list.append(
                _skip_judge_result("No live client available for LLM judge")
            )

    criterion_results = tuple(criterion_results_list)
    if case.grading_mode == "programmatic":
        score = programmatic_score
        passed = score >= 0.7
    elif case.grading_mode == "llm_judge":
        score = judge_score
        passed = judge_passed
    else:
        score = round((programmatic_score + judge_score) / 2.0, 4)
        passed = programmatic_score >= 0.7 and judge_passed

    return EvalResult(
        case_id=case.id,
        case_name=case.name,
        passed=passed,
        score=score,
        metrics=metrics,
        criterion_results=criterion_results,
        grading_mode=case.grading_mode,
    )


async def run_all(
    cases: tuple[EvalCase, ...],
    backend: str = "mock",
    live_client: AnthropicClient | None = None,
    judge_model: str = "claude-haiku-4-5-20251001",
) -> EvalReport:
    """Run all eval cases sequentially and aggregate results."""
    results: list[EvalResult] = []
    start_time = time.monotonic()

    for case in cases:
        logger.info("Running eval: {} ({})", case.name, case.id)
        result = await run_case(
            case, backend=backend, live_client=live_client, judge_model=judge_model
        )
        results.append(result)

    total_latency = round(time.monotonic() - start_time, 2)
    results_tuple = tuple(results)

    passed = sum(1 for r in results_tuple if r.passed)
    failed = sum(1 for r in results_tuple if not r.passed and r.error is None)
    errored = sum(1 for r in results_tuple if r.error is not None)
    scores = [r.score for r in results_tuple]
    overall_score = round(sum(scores) / len(scores), 4) if scores else 0.0

    return EvalReport(
        results=results_tuple,
        total_cases=len(results_tuple),
        passed_cases=passed,
        failed_cases=failed,
        error_cases=errored,
        overall_score=overall_score,
        total_latency_seconds=total_latency,
        total_input_tokens=sum(r.metrics.total_input_tokens for r in results_tuple),
        total_output_tokens=sum(r.metrics.total_output_tokens for r in results_tuple),
        timestamp=time.time(),
    )


def _error_result(case: EvalCase, error: str) -> EvalResult:
    """Build an EvalResult representing a case that failed to run."""
    from evals.models import EvalMetrics

    return EvalResult(
        case_id=case.id,
        case_name=case.name,
        passed=False,
        score=0.0,
        metrics=EvalMetrics(
            total_iterations=0,
            total_input_tokens=0,
            total_output_tokens=0,
            tool_calls=(),
            errors=(error,),
            latency_seconds=0.0,
            final_output="",
        ),
        criterion_results=(),
        grading_mode=case.grading_mode,
        error=error,
    )


def _skip_judge_result(reason: str) -> Any:
    from evals.models import CriterionResult

    return CriterionResult(
        criterion_name="llm_judge",
        passed=False,
        detail=f"Skipped: {reason}",
    )
