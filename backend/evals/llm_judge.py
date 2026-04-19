"""LLM-as-judge grading via Claude API."""

from __future__ import annotations

import json

from loguru import logger

from agent.llm.client import AnthropicClient

from evals.models import CriterionResult, EvalCase, EvalMetrics, JudgeOutcome

_DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"

_JUDGE_SYSTEM_PROMPT = """\
You are an evaluation judge for an AI agent system.
You will be given a task description, expected output hint, actual output, and tool call sequence.
Evaluate whether the agent completed the task correctly and effectively.

Respond with a JSON object containing exactly these fields:
- "passed": boolean — whether the agent completed the task satisfactorily
- "score": float between 0.0 and 1.0 — quality score
- "reasoning": string — brief explanation of your assessment

Respond ONLY with the JSON object, no other text."""


def _build_judge_prompt(
    case: EvalCase,
    metrics: EvalMetrics,
) -> str:
    """Build the user message for the LLM judge."""
    tool_summary = "\n".join(
        f"  {i + 1}. {tc.name}(…) → {'OK' if tc.success else 'FAIL'}"
        for i, tc in enumerate(metrics.tool_calls)
    )
    if not tool_summary:
        tool_summary = "  (no tool calls)"

    custom_prompt = ""
    if case.llm_judge_prompt:
        custom_prompt = f"\n## Custom Evaluation Criteria\n{case.llm_judge_prompt}\n"

    expected = ""
    if case.expected_output_hint:
        expected = f"\n## Expected Output Hint\n{case.expected_output_hint}\n"

    return f"""\
## Task
{case.description}

## User Message
{case.user_message}
{expected}{custom_prompt}
## Tool Call Sequence
{tool_summary}

## Agent Output
{metrics.final_output}

## Metrics
- Iterations: {metrics.total_iterations}
- Errors: {len(metrics.errors)}
"""


async def judge_with_llm(
    case: EvalCase,
    metrics: EvalMetrics,
    client: AnthropicClient,
    model: str = _DEFAULT_JUDGE_MODEL,
) -> JudgeOutcome:
    """Use an LLM to judge the quality of an eval run.

    Returns a structured outcome with the criterion result and numeric score.
    """
    user_message = _build_judge_prompt(case, metrics)

    try:
        response = await client.create_message(
            system=_JUDGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            model=model,
            max_tokens=512,
        )

        parsed = json.loads(response.text)
        passed = bool(parsed.get("passed", False))
        score = float(parsed.get("score", 0.0))
        reasoning = str(parsed.get("reasoning", ""))

        return JudgeOutcome(
            result=CriterionResult(
                criterion_name="llm_judge",
                passed=passed,
                detail=f"Score: {score:.2f} — {reasoning}",
            ),
            score=score,
        )
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.warning("LLM judge response parse failed model={}: {}", model, exc)
        return JudgeOutcome(
            result=CriterionResult(
                criterion_name="llm_judge",
                passed=False,
                detail=f"Failed to parse LLM judge response: {exc}",
            ),
            score=0.0,
        )
    except Exception as exc:
        logger.error("LLM judge call failed model={}: {}", model, exc)
        return JudgeOutcome(
            result=CriterionResult(
                criterion_name="llm_judge",
                passed=False,
                detail=f"LLM judge error: {exc}",
            ),
            score=0.0,
        )
