"""Tests for eval programmatic grader."""

from __future__ import annotations

from evals.grader import grade_criteria
from evals.models import (
    AgentHandoffRecord,
    AgentSpawnRecord,
    EvalMetrics,
    GradingCriteria,
    SkillActivationRecord,
    ToolCallRecord,
)


def _make_metrics(
    tool_calls: tuple[ToolCallRecord, ...] = (),
    final_output: str = "",
    total_iterations: int = 3,
    errors: tuple[str, ...] = (),
    skill_activations: tuple[SkillActivationRecord, ...] = (),
    agent_spawns: tuple[AgentSpawnRecord, ...] = (),
    agent_handoffs: tuple[AgentHandoffRecord, ...] = (),
) -> EvalMetrics:
    return EvalMetrics(
        total_iterations=total_iterations,
        total_input_tokens=100,
        total_output_tokens=50,
        tool_calls=tool_calls,
        errors=errors,
        latency_seconds=1.0,
        final_output=final_output,
        skill_activations=skill_activations,
        agent_spawns=agent_spawns,
        agent_handoffs=agent_handoffs,
    )


def _make_tool_call(name: str, success: bool = True) -> ToolCallRecord:
    return ToolCallRecord(
        name=name,
        input={},
        output="ok",
        success=success,
        iteration=1,
    )


class TestToolUsedCriterion:
    def test_tool_was_used(self) -> None:
        criteria = (
            GradingCriteria(name="used_search", type="tool_used", value="web_search"),
        )
        metrics = _make_metrics(tool_calls=(_make_tool_call("web_search"),))
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True
        assert score == 1.0

    def test_tool_was_not_used(self) -> None:
        criteria = (
            GradingCriteria(name="used_search", type="tool_used", value="web_search"),
        )
        metrics = _make_metrics(tool_calls=(_make_tool_call("code_run"),))
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False
        assert score == 0.0


class TestToolNotUsedCriterion:
    def test_tool_absent(self) -> None:
        criteria = (
            GradingCriteria(name="no_browser", type="tool_not_used", value="browser"),
        )
        metrics = _make_metrics(tool_calls=(_make_tool_call("web_search"),))
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_tool_present(self) -> None:
        criteria = (
            GradingCriteria(name="no_browser", type="tool_not_used", value="browser"),
        )
        metrics = _make_metrics(tool_calls=(_make_tool_call("browser"),))
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestOutputRegexCriterion:
    def test_regex_matches(self) -> None:
        criteria = (
            GradingCriteria(name="has_number", type="output_regex", value=r"\d+"),
        )
        metrics = _make_metrics(final_output="The answer is 42.")
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_regex_no_match(self) -> None:
        criteria = (
            GradingCriteria(name="has_number", type="output_regex", value=r"\d+"),
        )
        metrics = _make_metrics(final_output="No numbers here.")
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestOutputContainsCriterion:
    def test_substring_found(self) -> None:
        criteria = (
            GradingCriteria(name="has_hello", type="output_contains", value="hello"),
        )
        metrics = _make_metrics(final_output="Hello world!")
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True  # case-insensitive

    def test_substring_not_found(self) -> None:
        criteria = (
            GradingCriteria(name="has_hello", type="output_contains", value="goodbye"),
        )
        metrics = _make_metrics(final_output="Hello world!")
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestMaxIterationsCriterion:
    def test_within_limit(self) -> None:
        criteria = (GradingCriteria(name="iter_limit", type="max_iterations", value=5),)
        metrics = _make_metrics(total_iterations=3)
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_exceeds_limit(self) -> None:
        criteria = (GradingCriteria(name="iter_limit", type="max_iterations", value=2),)
        metrics = _make_metrics(total_iterations=3)
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestNoErrorsCriterion:
    def test_no_errors(self) -> None:
        criteria = (GradingCriteria(name="clean", type="no_errors"),)
        metrics = _make_metrics(errors=())
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_has_errors(self) -> None:
        criteria = (GradingCriteria(name="clean", type="no_errors"),)
        metrics = _make_metrics(errors=("something went wrong",))
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestWeightedScoring:
    def test_weighted_score(self) -> None:
        criteria = (
            GradingCriteria(name="a", type="no_errors", weight=2.0),
            GradingCriteria(
                name="b", type="output_contains", value="missing", weight=1.0
            ),
        )
        metrics = _make_metrics(final_output="hello", errors=())
        results, score = grade_criteria(criteria, metrics)
        # a passes (weight 2), b fails (weight 1) => 2/3
        assert results[0].passed is True
        assert results[1].passed is False
        assert abs(score - 2.0 / 3.0) < 0.01

    def test_all_pass(self) -> None:
        criteria = (
            GradingCriteria(name="a", type="no_errors", weight=1.0),
            GradingCriteria(
                name="b", type="output_contains", value="hello", weight=1.0
            ),
        )
        metrics = _make_metrics(final_output="hello", errors=())
        _, score = grade_criteria(criteria, metrics)
        assert score == 1.0

    def test_all_fail(self) -> None:
        criteria = (
            GradingCriteria(name="a", type="no_errors", weight=1.0),
            GradingCriteria(
                name="b", type="output_contains", value="missing", weight=1.0
            ),
        )
        metrics = _make_metrics(final_output="hello", errors=("err",))
        _, score = grade_criteria(criteria, metrics)
        assert score == 0.0


class TestSkillActivatedCriterion:
    def test_skill_was_activated(self) -> None:
        criteria = (
            GradingCriteria(
                name="activated_ds", type="skill_activated", value="data_science"
            ),
        )
        metrics = _make_metrics(
            skill_activations=(
                SkillActivationRecord(name="data_science", source="explicit"),
            ),
        )
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True
        assert score == 1.0

    def test_skill_not_activated(self) -> None:
        criteria = (
            GradingCriteria(
                name="activated_ds", type="skill_activated", value="data_science"
            ),
        )
        metrics = _make_metrics(skill_activations=())
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is False

    def test_wrong_skill_activated(self) -> None:
        criteria = (
            GradingCriteria(
                name="activated_ds", type="skill_activated", value="data_science"
            ),
        )
        metrics = _make_metrics(
            skill_activations=(SkillActivationRecord(name="web_dev", source="auto"),),
        )
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestAgentSpawnedCriterion:
    def test_agent_spawned_any(self) -> None:
        criteria = (GradingCriteria(name="spawned", type="agent_spawned"),)
        metrics = _make_metrics(
            agent_spawns=(AgentSpawnRecord(agent_id="a1", task="research"),),
        )
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_no_agents_spawned(self) -> None:
        criteria = (GradingCriteria(name="spawned", type="agent_spawned"),)
        metrics = _make_metrics(agent_spawns=())
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is False

    def test_agent_count_check(self) -> None:
        criteria = (GradingCriteria(name="spawned_2", type="agent_spawned", value=2),)
        metrics = _make_metrics(
            agent_spawns=(
                AgentSpawnRecord(agent_id="a1", task="task1"),
                AgentSpawnRecord(agent_id="a2", task="task2"),
                AgentSpawnRecord(agent_id="a3", task="task3"),
            ),
        )
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_agent_count_insufficient(self) -> None:
        criteria = (GradingCriteria(name="spawned_3", type="agent_spawned", value=3),)
        metrics = _make_metrics(
            agent_spawns=(AgentSpawnRecord(agent_id="a1", task="task1"),),
        )
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is False

    def test_agent_task_substring(self) -> None:
        criteria = (
            GradingCriteria(
                name="has_research", type="agent_spawned", value="research"
            ),
        )
        metrics = _make_metrics(
            agent_spawns=(AgentSpawnRecord(agent_id="a1", task="Research AI trends"),),
        )
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is True


class TestAgentHandoffCriterion:
    def test_handoff_occurred(self) -> None:
        criteria = (GradingCriteria(name="handoff", type="agent_handoff"),)
        metrics = _make_metrics(
            agent_handoffs=(
                AgentHandoffRecord(
                    source_agent_id="a1",
                    target_role="reviewer",
                    reason="needs review",
                    handoff_depth=1,
                ),
            ),
        )
        results, score = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_no_handoff(self) -> None:
        criteria = (GradingCriteria(name="handoff", type="agent_handoff"),)
        metrics = _make_metrics(agent_handoffs=())
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is False

    def test_handoff_to_specific_role(self) -> None:
        criteria = (
            GradingCriteria(
                name="handoff_reviewer",
                type="agent_handoff",
                value="security_reviewer",
            ),
        )
        metrics = _make_metrics(
            agent_handoffs=(
                AgentHandoffRecord(
                    source_agent_id="a1",
                    target_role="security_reviewer",
                    reason="security audit",
                    handoff_depth=1,
                ),
            ),
        )
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_handoff_wrong_role(self) -> None:
        criteria = (
            GradingCriteria(
                name="handoff_reviewer",
                type="agent_handoff",
                value="security_reviewer",
            ),
        )
        metrics = _make_metrics(
            agent_handoffs=(
                AgentHandoffRecord(
                    source_agent_id="a1",
                    target_role="coder",
                    reason="code",
                    handoff_depth=1,
                ),
            ),
        )
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is False


class TestToolCallCountCriterion:
    def test_within_limit(self) -> None:
        criteria = (GradingCriteria(name="count", type="tool_call_count", value=5),)
        metrics = _make_metrics(tool_calls=(_make_tool_call("a"), _make_tool_call("b")))
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is True

    def test_exceeds_limit(self) -> None:
        criteria = (GradingCriteria(name="count", type="tool_call_count", value=1),)
        metrics = _make_metrics(tool_calls=(_make_tool_call("a"), _make_tool_call("b")))
        results, _ = grade_criteria(criteria, metrics)
        assert results[0].passed is False
