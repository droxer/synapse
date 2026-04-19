"""Tests for eval runner — end-to-end mock eval execution."""

from __future__ import annotations

import json

import pytest

from evals.models import EvalCase, GradingCriteria
from evals.runner import run_all, run_case


def _simple_case(
    case_id: str = "test_1",
    mock_responses: tuple[dict, ...] | None = None,
) -> EvalCase:
    """Build a minimal eval case for testing."""
    if mock_responses is None:
        mock_responses = (
            {
                "text": "Let me search.",
                "tool_calls": [
                    {"id": "tc_1", "name": "web_search", "input": {"query": "test"}}
                ],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 100, "output_tokens": 40},
            },
            {
                "text": "Found the answer with hello.",
                "tool_calls": [],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 200, "output_tokens": 60},
            },
        )
    return EvalCase(
        id=case_id,
        name=f"Test Case {case_id}",
        description="A test eval case",
        user_message="Search for something",
        grading_mode="programmatic",
        criteria=(
            GradingCriteria(
                name="used_search", type="tool_used", value="web_search", weight=2.0
            ),
            GradingCriteria(
                name="has_hello", type="output_contains", value="hello", weight=1.0
            ),
            GradingCriteria(name="no_errors", type="no_errors", weight=1.0),
        ),
        tags=("test",),
        max_iterations=10,
        mock_responses=mock_responses,
    )


class _JudgeClient:
    def __init__(self, *, passed: bool, score: float, reasoning: str = "ok") -> None:
        self._response_text = json.dumps(
            {
                "passed": passed,
                "score": score,
                "reasoning": reasoning,
            }
        )

    async def create_message(
        self,
        system: str,
        messages: list[dict],
        model: str | None = None,
        max_tokens: int | None = None,
    ):
        return type("JudgeResponse", (), {"text": self._response_text})()


@pytest.fixture(autouse=True)
def _required_eval_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("TAVILY_API_KEY", "test")


class TestRunCase:
    async def test_mock_case_passes(self) -> None:
        case = _simple_case()
        result = await run_case(case, backend="mock")
        assert result.case_id == "test_1"
        assert result.score > 0
        assert result.metrics.total_iterations > 0
        assert len(result.criterion_results) == 3

    async def test_mock_case_tracks_tool_calls(self) -> None:
        case = _simple_case()
        result = await run_case(case, backend="mock")
        tool_names = [tc.name for tc in result.metrics.tool_calls]
        assert "web_search" in tool_names

    async def test_case_without_mock_responses(self) -> None:
        case = EvalCase(
            id="no_mock",
            name="No Mock",
            description="desc",
            user_message="hello",
            grading_mode="programmatic",
            criteria=(GradingCriteria(name="no_err", type="no_errors"),),
        )
        result = await run_case(case, backend="mock")
        assert result.case_id == "no_mock"
        assert result.metrics.total_iterations > 0

    async def test_unknown_backend_returns_error(self) -> None:
        case = _simple_case()
        result = await run_case(case, backend="nonexistent")
        assert result.error is not None
        assert result.passed is False

    async def test_live_without_client_returns_error(self) -> None:
        case = _simple_case()
        result = await run_case(case, backend="live", live_client=None)
        assert result.error is not None

    async def test_both_mode_passes_only_when_programmatic_and_judge_pass(
        self,
    ) -> None:
        case = EvalCase(
            id="both_pass",
            name="Both Pass",
            description="desc",
            user_message="hello",
            grading_mode="both",
            criteria=(
                GradingCriteria(name="hello", type="output_contains", value="hello"),
            ),
            mock_responses=(
                {
                    "text": "hello there",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(
            case,
            backend="mock",
            live_client=_JudgeClient(passed=True, score=0.8),
        )
        assert result.passed is True
        assert result.score == 0.9

    async def test_both_mode_fails_when_judge_fails(self) -> None:
        case = EvalCase(
            id="both_judge_fail",
            name="Both Judge Fail",
            description="desc",
            user_message="hello",
            grading_mode="both",
            criteria=(
                GradingCriteria(name="hello", type="output_contains", value="hello"),
            ),
            mock_responses=(
                {
                    "text": "hello there",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(
            case,
            backend="mock",
            live_client=_JudgeClient(passed=False, score=0.2),
        )
        assert result.passed is False
        assert result.score == 0.6

    async def test_both_mode_fails_when_programmatic_fails(self) -> None:
        case = EvalCase(
            id="both_programmatic_fail",
            name="Both Programmatic Fail",
            description="desc",
            user_message="hello",
            grading_mode="both",
            criteria=(
                GradingCriteria(name="hello", type="output_contains", value="hello"),
            ),
            mock_responses=(
                {
                    "text": "goodbye",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(
            case,
            backend="mock",
            live_client=_JudgeClient(passed=True, score=1.0),
        )
        assert result.passed is False
        assert result.score == 0.5

    async def test_both_mode_without_live_client_cannot_pass(self) -> None:
        case = EvalCase(
            id="both_no_judge",
            name="Both No Judge",
            description="desc",
            user_message="hello",
            grading_mode="both",
            criteria=(
                GradingCriteria(name="hello", type="output_contains", value="hello"),
            ),
            mock_responses=(
                {
                    "text": "hello there",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(case, backend="mock", live_client=None)
        assert result.passed is False
        assert result.score == 0.5
        assert result.criterion_results[-1].criterion_name == "llm_judge"
        assert result.criterion_results[-1].passed is False

    async def test_mock_activate_skill_emits_skill_activation(self) -> None:
        case = EvalCase(
            id="skill_activation",
            name="Skill Activation",
            description="desc",
            user_message="activate a skill",
            grading_mode="programmatic",
            criteria=(
                GradingCriteria(
                    name="skill_active",
                    type="skill_activated",
                    value="data_science",
                ),
            ),
            mock_responses=(
                {
                    "text": "Activating skill.",
                    "tool_calls": [
                        {
                            "id": "tc_skill",
                            "name": "activate_skill",
                            "input": {"name": "data_science"},
                        }
                    ],
                    "stop_reason": "tool_use",
                },
                {
                    "text": "Done",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(case, backend="mock")
        assert result.passed is True
        assert result.metrics.skill_activations[0].name == "data_science"

    async def test_mock_agent_spawn_emits_agent_spawn(self) -> None:
        case = EvalCase(
            id="agent_spawn",
            name="Agent Spawn",
            description="desc",
            user_message="spawn agent",
            grading_mode="programmatic",
            criteria=(GradingCriteria(name="spawned", type="agent_spawned", value=1),),
            mock_responses=(
                {
                    "text": "Spawning agent.",
                    "tool_calls": [
                        {
                            "id": "tc_spawn",
                            "name": "agent_spawn",
                            "input": {"task_description": "Research AI trends"},
                        }
                    ],
                    "stop_reason": "tool_use",
                },
                {
                    "text": "Done",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(case, backend="mock")
        assert result.passed is True
        assert result.metrics.agent_spawns[0].task == "Research AI trends"

    async def test_mock_agent_handoff_emits_agent_handoff(self) -> None:
        case = EvalCase(
            id="agent_handoff_event",
            name="Agent Handoff Event",
            description="desc",
            user_message="handoff agent",
            grading_mode="programmatic",
            criteria=(
                GradingCriteria(
                    name="handoff",
                    type="agent_handoff",
                    value="security_reviewer",
                ),
            ),
            mock_responses=(
                {
                    "text": "Handing off.",
                    "tool_calls": [
                        {
                            "id": "tc_handoff",
                            "name": "agent_handoff",
                            "input": {
                                "target_role": "security_reviewer",
                                "context": "needs security review",
                            },
                        }
                    ],
                    "stop_reason": "tool_use",
                },
                {
                    "text": "Done",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )
        result = await run_case(case, backend="mock")
        assert result.passed is True
        assert result.metrics.agent_handoffs[0].target_role == "security_reviewer"

    async def test_mock_planner_case_runs_real_planner_path(self) -> None:
        case = EvalCase(
            id="planner_mode",
            name="Planner Mode",
            description="Exercise planner guardrails in eval harness",
            user_message="Research the repository and summarize the findings.",
            grading_mode="programmatic",
            orchestrator_mode="planner",
            explicit_planner=True,
            criteria=(
                GradingCriteria(
                    name="planner_mode",
                    type="orchestrator_mode",
                    value="planner",
                ),
                GradingCriteria(name="plan_visible", type="plan_created", value=1),
                GradingCriteria(
                    name="nudged_before_plan",
                    type="loop_guard_nudged",
                    value=1,
                ),
                GradingCriteria(name="spawned", type="agent_spawned", value=1),
            ),
            mock_responses=(
                {
                    "text": "Done without planning.",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
                {
                    "text": "",
                    "tool_calls": [
                        {
                            "id": "tc_plan",
                            "name": "plan_create",
                            "input": {
                                "steps": [
                                    {
                                        "name": "Research findings",
                                        "description": "Collect the relevant findings.",
                                        "execution_type": "parallel_worker",
                                    }
                                ]
                            },
                        },
                        {
                            "id": "tc_spawn",
                            "name": "agent_spawn",
                            "input": {
                                "name": "Research findings",
                                "task_description": "Research the repository findings.",
                            },
                        },
                    ],
                    "stop_reason": "tool_use",
                },
                {
                    "text": "",
                    "tool_calls": [
                        {
                            "id": "tc_wait",
                            "name": "agent_wait",
                            "input": {"agent_ids": ["mock-agent-1"]},
                        }
                    ],
                    "stop_reason": "tool_use",
                },
                {
                    "text": "Done",
                    "tool_calls": [],
                    "stop_reason": "end_turn",
                },
            ),
        )

        result = await run_case(case, backend="mock")

        assert result.passed is True
        assert result.metrics.orchestrator_mode == "planner"
        assert result.metrics.plan_created_count == 1
        assert result.metrics.loop_guard_nudge_count == 1
        assert (
            result.metrics.agent_spawns[0].task == "Research the repository findings."
        )


class TestRunAll:
    async def test_run_multiple_cases(self) -> None:
        cases = (_simple_case("c1"), _simple_case("c2"))
        report = await run_all(cases, backend="mock")
        assert report.total_cases == 2
        assert report.total_latency_seconds >= 0
        assert report.overall_score > 0
        assert report.total_input_tokens > 0
        assert report.total_output_tokens > 0

    async def test_report_counts(self) -> None:
        cases = (_simple_case("c1"),)
        report = await run_all(cases, backend="mock")
        assert (
            report.passed_cases + report.failed_cases + report.error_cases
            == report.total_cases
        )
