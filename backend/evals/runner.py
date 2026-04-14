"""Eval runner — wires orchestrator, runs cases, collects and grades results."""

from __future__ import annotations

import time
from typing import Any

from loguru import logger

from agent.llm.client import AnthropicClient
from agent.context.compaction import Observer
from agent.runtime.orchestrator import AgentOrchestrator
from agent.tools.base import ToolResult
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter

from evals.collector import EvalCollector
from evals.grader import grade_criteria
from evals.llm_judge import judge_with_llm
from evals.mock_client import MockToolExecutor, ScriptedLLMClient
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
        return ToolResult.ok(f"[mock] {self._name} executed")


def _build_mock_registry() -> ToolRegistry:
    """Build a minimal tool registry with placeholder tools for mock mode."""
    registry = ToolRegistry()
    tools = [
        ("web_search", "Search the web for information"),
        ("web_fetch", "Fetch content from a URL"),
        ("code_run", "Run code in a sandbox"),
        ("code_interpret", "Interpret and execute Python code"),
        ("shell_exec", "Execute a shell command"),
        ("task_complete", "Mark the task as complete"),
        ("message_user", "Send a message to the user"),
        ("activate_skill", "Activate a skill for expert methodology"),
        ("agent_spawn", "Spawn a new task agent for a sub-task"),
        ("agent_wait", "Wait for task agents to complete"),
        ("agent_handoff", "Hand off to a specialist agent"),
    ]
    for name, desc in tools:
        registry = registry.register(_SimpleLocalTool(name, desc))
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
            registry = _build_mock_registry()
            executor = MockToolExecutor()
        elif backend == "live":
            if live_client is None:
                return _error_result(case, "live_client required for backend='live'")
            client = live_client
            registry = _build_mock_registry()
            # In live mode, use mock executor for tool execution
            # (we're testing the LLM, not the tools)
            executor = MockToolExecutor()
        else:
            return _error_result(case, f"Unknown backend: {backend}")

        on_complete = _NoOpTaskComplete()

        # Use custom token budget if specified in the eval case
        observer = None
        if case.token_budget > 0:
            observer = Observer(token_budget=case.token_budget)

        orchestrator = AgentOrchestrator(
            claude_client=client,
            tool_registry=registry,
            tool_executor=executor,  # type: ignore[arg-type]
            event_emitter=emitter,
            system_prompt="You are a helpful assistant being evaluated. Use the available tools to complete the task.",
            max_iterations=case.max_iterations,
            observer=observer,
        )
        on_complete.set(orchestrator.on_task_complete)

        await orchestrator.run(case.user_message)

    except Exception as exc:
        logger.error("Eval case '{}' raised: {}", case.id, exc)
        return _error_result(case, str(exc))

    metrics = collector.to_metrics()

    # Grade
    criterion_results_list: list[Any] = []
    score = 0.0

    if case.grading_mode in ("programmatic", "both"):
        programmatic_results, score = grade_criteria(case.criteria, metrics)
        criterion_results_list.extend(programmatic_results)

    if case.grading_mode in ("llm_judge", "both"):
        if live_client is not None:
            judge_result = await judge_with_llm(
                case, metrics, live_client, model=judge_model
            )
            criterion_results_list.append(judge_result)
            if case.grading_mode == "llm_judge":
                # For pure LLM judge, extract score from the detail
                score = 1.0 if judge_result.passed else 0.0
        else:
            criterion_results_list.append(
                _skip_judge_result("No live client available for LLM judge")
            )

    criterion_results = tuple(criterion_results_list)
    passed = score >= 0.7  # Pass threshold

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
