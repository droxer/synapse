"""CLI entry point: uv run python -m evals [options]."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="evals",
        description="Run HiAgent agent evaluations",
    )
    parser.add_argument(
        "--cases-dir",
        type=str,
        default=None,
        help="Path to eval cases directory (default: evals/cases)",
    )
    parser.add_argument(
        "--case",
        type=str,
        default=None,
        help="Run a single case by id",
    )
    parser.add_argument(
        "--tags",
        type=str,
        default=None,
        help="Filter by tags (comma-separated)",
    )
    parser.add_argument(
        "--backend",
        type=str,
        choices=["mock", "live"],
        default="mock",
        help="LLM backend: mock (scripted) or live (real API)",
    )
    parser.add_argument(
        "--judge-model",
        type=str,
        default="claude-haiku-4-5-20251001",
        help="Model for LLM-as-judge grading",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Write JSON report to this file",
    )
    return parser.parse_args()


async def _main() -> int:
    args = _parse_args()

    from evals.loader import load_cases
    from evals.reporter import format_console_report, write_json_report
    from evals.runner import run_all

    # Resolve cases directory
    if args.cases_dir:
        cases_dir = Path(args.cases_dir)
    else:
        cases_dir = Path(__file__).parent / "cases"

    tags = tuple(t.strip() for t in args.tags.split(",")) if args.tags else ()

    try:
        cases = load_cases(cases_dir, case_id=args.case, tags=tags)
    except (FileNotFoundError, Exception) as exc:
        print(f"Error loading cases: {exc}", file=sys.stderr)
        return 1

    if not cases:
        print("No eval cases matched the filters.", file=sys.stderr)
        return 1

    print(f"Running {len(cases)} eval case(s) with backend={args.backend}...")

    # Build live client if needed
    live_client = None
    if args.backend == "live":
        from agent.llm.client import AnthropicClient
        from config.settings import get_settings

        settings = get_settings()
        live_client = AnthropicClient(api_key=settings.ANTHROPIC_API_KEY)

    try:
        report = await run_all(
            cases,
            backend=args.backend,
            live_client=live_client,
            judge_model=args.judge_model,
        )
    finally:
        if live_client is not None:
            await live_client.close()

    print(format_console_report(report))

    if args.output:
        write_json_report(report, args.output)
        print(f"JSON report written to: {args.output}")

    return 0 if report.failed_cases == 0 and report.error_cases == 0 else 1


def main() -> None:
    sys.exit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
