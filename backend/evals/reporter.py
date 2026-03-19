"""Console and JSON report output for eval results."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any

from evals.models import EvalReport, EvalResult


def format_console_report(report: EvalReport) -> str:
    """Format an EvalReport as a human-readable console string."""
    lines: list[str] = []
    lines.append("")
    lines.append("\u2550\u2550 Eval Report \u2550" * 4)
    lines.append(
        f"Total: {report.total_cases} | "
        f"Passed: {report.passed_cases} | "
        f"Failed: {report.failed_cases} | "
        f"Errors: {report.error_cases} | "
        f"Score: {report.overall_score:.2f}"
    )
    lines.append(
        f"Tokens: {report.total_input_tokens:,} in / "
        f"{report.total_output_tokens:,} out | "
        f"Time: {report.total_latency_seconds:.1f}s"
    )
    lines.append("")

    for result in report.results:
        lines.append(_format_result_line(result))
        if not result.passed:
            for cr in result.criterion_results:
                status = "PASS" if cr.passed else "FAIL"
                lines.append(f"        - {cr.criterion_name}: {status}")
        if result.error:
            lines.append(f"        ERROR: {result.error}")

    lines.append("")
    return "\n".join(lines)


def _format_result_line(result: EvalResult) -> str:
    """Format a single result as a console line."""
    status = "  PASS" if result.passed else "  FAIL"
    iters = result.metrics.total_iterations
    latency = result.metrics.latency_seconds
    return (
        f"{status}  {result.case_name:<30} "
        f"{result.score:.2f}  "
        f"({iters} iters, {latency:.1f}s)"
    )


def report_to_dict(report: EvalReport) -> dict[str, Any]:
    """Convert an EvalReport to a JSON-serializable dict."""
    return asdict(report)


def write_json_report(report: EvalReport, path: str) -> None:
    """Write an EvalReport as a JSON file."""
    data = report_to_dict(report)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
