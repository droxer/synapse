"""Core types for the agent evaluation system."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class GradingCriteria:
    """A single grading criterion for an eval case."""

    name: str
    type: str  # tool_used | tool_not_used | output_regex | output_contains | max_iterations | no_errors | skill_activated | agent_spawned | agent_handoff | tool_call_count
    value: str | int | None = None
    weight: float = 1.0


@dataclass(frozen=True)
class EvalCase:
    """Definition of a single evaluation scenario."""

    id: str
    name: str
    description: str
    user_message: str
    grading_mode: str  # programmatic | llm_judge | both
    criteria: tuple[GradingCriteria, ...]
    llm_judge_prompt: str | None = None
    expected_output_hint: str | None = None
    tags: tuple[str, ...] = ()
    max_iterations: int = 50
    mock_responses: tuple[dict[str, Any], ...] | None = None


@dataclass(frozen=True)
class ToolCallRecord:
    """Record of a single tool invocation during evaluation."""

    name: str
    input: dict[str, Any]
    output: str
    success: bool
    iteration: int


@dataclass(frozen=True)
class SkillActivationRecord:
    """Record of a skill activation during evaluation."""

    name: str
    source: str  # "auto" | "explicit" | "mid_turn"


@dataclass(frozen=True)
class AgentSpawnRecord:
    """Record of a sub-agent spawn during evaluation."""

    agent_id: str
    task: str


@dataclass(frozen=True)
class AgentHandoffRecord:
    """Record of an agent handoff during evaluation."""

    source_agent_id: str
    target_role: str
    reason: str
    handoff_depth: int


@dataclass(frozen=True)
class EvalMetrics:
    """Collected metrics from a single eval run."""

    total_iterations: int
    total_input_tokens: int
    total_output_tokens: int
    tool_calls: tuple[ToolCallRecord, ...]
    errors: tuple[str, ...]
    latency_seconds: float
    final_output: str
    skill_activations: tuple[SkillActivationRecord, ...] = ()
    agent_spawns: tuple[AgentSpawnRecord, ...] = ()
    agent_handoffs: tuple[AgentHandoffRecord, ...] = ()


@dataclass(frozen=True)
class CriterionResult:
    """Result of evaluating a single grading criterion."""

    criterion_name: str
    passed: bool
    detail: str


@dataclass(frozen=True)
class EvalResult:
    """Full result of running and grading a single eval case."""

    case_id: str
    case_name: str
    passed: bool
    score: float  # 0.0-1.0 weighted
    metrics: EvalMetrics
    criterion_results: tuple[CriterionResult, ...]
    grading_mode: str
    error: str | None = None


@dataclass(frozen=True)
class EvalReport:
    """Aggregated report across all eval cases."""

    results: tuple[EvalResult, ...]
    total_cases: int
    passed_cases: int
    failed_cases: int
    error_cases: int
    overall_score: float
    total_latency_seconds: float
    total_input_tokens: int
    total_output_tokens: int
    timestamp: float
