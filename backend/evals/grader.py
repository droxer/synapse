"""Programmatic grading of eval metrics against criteria."""

from __future__ import annotations

import re

from evals.models import CriterionResult, EvalMetrics, GradingCriteria


def _grade_tool_used(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    tool_name = str(criteria.value or "")
    found = any(tc.name == tool_name for tc in metrics.tool_calls)
    return CriterionResult(
        criterion_name=criteria.name,
        passed=found,
        detail=f"Tool '{tool_name}' {'was' if found else 'was NOT'} used",
    )


def _grade_tool_not_used(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    tool_name = str(criteria.value or "")
    found = any(tc.name == tool_name for tc in metrics.tool_calls)
    return CriterionResult(
        criterion_name=criteria.name,
        passed=not found,
        detail=f"Tool '{tool_name}' {'was' if found else 'was NOT'} used",
    )


def _grade_output_regex(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    pattern = str(criteria.value or "")
    matched = bool(re.search(pattern, metrics.final_output))
    return CriterionResult(
        criterion_name=criteria.name,
        passed=matched,
        detail=f"Regex '{pattern}' {'matched' if matched else 'did NOT match'} output",
    )


def _grade_output_contains(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    substring = str(criteria.value or "")
    found = substring.lower() in metrics.final_output.lower()
    return CriterionResult(
        criterion_name=criteria.name,
        passed=found,
        detail=f"Substring '{substring}' {'found' if found else 'NOT found'} in output",
    )


def _grade_max_iterations(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    limit = int(criteria.value or 0)
    passed = metrics.total_iterations <= limit
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=f"Iterations: {metrics.total_iterations} (limit: {limit})",
    )


def _grade_no_errors(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    passed = len(metrics.errors) == 0
    detail = "No errors" if passed else f"Errors: {', '.join(metrics.errors)}"
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=detail,
    )


def _grade_skill_activated(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    skill_name = str(criteria.value or "")
    found = any(sa.name == skill_name for sa in metrics.skill_activations)
    return CriterionResult(
        criterion_name=criteria.name,
        passed=found,
        detail=f"Skill '{skill_name}' {'was' if found else 'was NOT'} activated",
    )


def _grade_agent_spawned(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    """Check that at least one agent was spawned.

    If value is an int, checks that at least that many agents were spawned.
    If value is a string, checks that an agent with a matching task substring exists.
    """
    value = criteria.value
    if isinstance(value, int):
        count = len(metrics.agent_spawns)
        passed = count >= value
        return CriterionResult(
            criterion_name=criteria.name,
            passed=passed,
            detail=f"Agents spawned: {count} (required: >= {value})",
        )
    if isinstance(value, str) and value:
        found = any(value.lower() in s.task.lower() for s in metrics.agent_spawns)
        return CriterionResult(
            criterion_name=criteria.name,
            passed=found,
            detail=(
                f"Agent with task containing '{value}' "
                f"{'was' if found else 'was NOT'} spawned"
            ),
        )
    # No value — just check any spawn happened
    passed = len(metrics.agent_spawns) > 0
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=f"Agents spawned: {len(metrics.agent_spawns)}",
    )


def _grade_agent_handoff(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    """Check that at least one handoff occurred.

    If value is a string, checks that a handoff to that target_role exists.
    """
    target_role = str(criteria.value or "")
    if target_role:
        found = any(h.target_role == target_role for h in metrics.agent_handoffs)
        return CriterionResult(
            criterion_name=criteria.name,
            passed=found,
            detail=(
                f"Handoff to role '{target_role}' "
                f"{'occurred' if found else 'did NOT occur'}"
            ),
        )
    passed = len(metrics.agent_handoffs) > 0
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=f"Handoffs: {len(metrics.agent_handoffs)}",
    )


def _grade_tool_call_count(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    """Check total number of tool calls is within a limit."""
    limit = int(criteria.value or 0)
    count = len(metrics.tool_calls)
    passed = count <= limit
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=f"Tool calls: {count} (limit: {limit})",
    )


def _grade_context_compacted(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    """Check that context compaction occurred at least once.

    If value is an int, checks that compaction happened at least that many times.
    """
    required = int(criteria.value) if criteria.value is not None else 1
    count = metrics.context_compaction_count
    passed = count >= required
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=f"Context compactions: {count} (required: >= {required})",
    )


def _grade_tool_not_repeated(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    """Check that a specific tool was not called more than once.

    Useful for verifying that compaction prevented redundant tool re-invocations.
    """
    tool_name = str(criteria.value or "")
    calls = [tc for tc in metrics.tool_calls if tc.name == tool_name]
    count = len(calls)
    passed = count <= 1
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=(
            f"Tool '{tool_name}' called {count} time(s) "
            f"({'OK — not repeated' if passed else 'REPEATED'})"
        ),
    )


def _grade_execution_shape(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    expected = str(criteria.value or "")
    passed = metrics.execution_shape == expected
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=(
            f"Execution shape: {metrics.execution_shape or '(missing)'} "
            f"(expected: {expected})"
        ),
    )


def _grade_orchestrator_mode(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    expected = str(criteria.value or "")
    passed = metrics.orchestrator_mode == expected
    return CriterionResult(
        criterion_name=criteria.name,
        passed=passed,
        detail=(
            f"Orchestrator mode: {metrics.orchestrator_mode or '(missing)'} "
            f"(expected: {expected})"
        ),
    )


def _grade_count_at_least(
    *,
    criterion_name: str,
    label: str,
    count: int,
    required_value: str | int | None,
) -> CriterionResult:
    required = int(required_value) if required_value is not None else 1
    passed = count >= required
    return CriterionResult(
        criterion_name=criterion_name,
        passed=passed,
        detail=f"{label}: {count} (required: >= {required})",
    )


def _grade_plan_created(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    return _grade_count_at_least(
        criterion_name=criteria.name,
        label="Plans created",
        count=metrics.plan_created_count,
        required_value=criteria.value,
    )


def _grade_loop_guard_nudged(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    return _grade_count_at_least(
        criterion_name=criteria.name,
        label="Loop guard nudges",
        count=metrics.loop_guard_nudge_count,
        required_value=criteria.value,
    )


def _grade_planner_auto_selected(
    criteria: GradingCriteria, metrics: EvalMetrics
) -> CriterionResult:
    return _grade_count_at_least(
        criterion_name=criteria.name,
        label="Planner auto-selected events",
        count=metrics.planner_auto_selected_count,
        required_value=criteria.value,
    )


_GRADERS = {
    "tool_used": _grade_tool_used,
    "tool_not_used": _grade_tool_not_used,
    "output_regex": _grade_output_regex,
    "output_contains": _grade_output_contains,
    "max_iterations": _grade_max_iterations,
    "no_errors": _grade_no_errors,
    "skill_activated": _grade_skill_activated,
    "agent_spawned": _grade_agent_spawned,
    "agent_handoff": _grade_agent_handoff,
    "tool_call_count": _grade_tool_call_count,
    "context_compacted": _grade_context_compacted,
    "tool_not_repeated": _grade_tool_not_repeated,
    "execution_shape": _grade_execution_shape,
    "orchestrator_mode": _grade_orchestrator_mode,
    "plan_created": _grade_plan_created,
    "loop_guard_nudged": _grade_loop_guard_nudged,
    "planner_auto_selected": _grade_planner_auto_selected,
}


def grade_criteria(
    criteria: tuple[GradingCriteria, ...],
    metrics: EvalMetrics,
) -> tuple[tuple[CriterionResult, ...], float]:
    """Grade all criteria against metrics.

    Returns:
        A tuple of (criterion_results, weighted_score).
        The score is in [0.0, 1.0].
    """
    results: list[CriterionResult] = []
    total_weight = 0.0
    weighted_sum = 0.0

    for criterion in criteria:
        grader_fn = _GRADERS.get(criterion.type)
        if grader_fn is None:
            results.append(
                CriterionResult(
                    criterion_name=criterion.name,
                    passed=False,
                    detail=f"Unknown criterion type: {criterion.type}",
                )
            )
            total_weight += criterion.weight
            continue

        result = grader_fn(criterion, metrics)
        results.append(result)
        total_weight += criterion.weight
        if result.passed:
            weighted_sum += criterion.weight

    score = weighted_sum / total_weight if total_weight > 0 else 0.0
    return tuple(results), round(score, 4)
