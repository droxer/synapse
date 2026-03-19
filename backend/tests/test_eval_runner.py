"""Tests for eval runner — end-to-end mock eval execution."""

from __future__ import annotations

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
