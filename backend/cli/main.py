"""CLI for Synapse public backend API (/v1)."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from typing import Any

import httpx


class PublicApiClient:
    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> httpx.Response:
        url = f"{self._base_url}{path}"
        headers = dict(self._headers)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    json=json_body,
                )
        except httpx.RequestError as exc:
            _print_transport_error(exc, url)
            raise SystemExit(1) from exc
        if response.status_code >= 400:
            _print_error(response)
            raise SystemExit(1)
        return response

    async def create_run(
        self,
        message: str,
        *,
        skills: list[str],
        use_planner: bool | None,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "message": message,
            "skills": skills,
            "metadata": {},
        }
        if use_planner is not None:
            body["use_planner"] = use_planner
        response = await self._request(
            "POST",
            "/v1/agent-runs",
            json_body=body,
            idempotency_key=idempotency_key,
        )
        return response.json()

    async def create_message(
        self,
        conversation_id: str,
        message: str,
        *,
        skills: list[str],
        use_planner: bool | None,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "message": message,
            "skills": skills,
            "metadata": {},
        }
        if use_planner is not None:
            body["use_planner"] = use_planner
        response = await self._request(
            "POST",
            f"/v1/conversations/{conversation_id}/messages",
            json_body=body,
            idempotency_key=idempotency_key,
        )
        return response.json()

    async def run_status(self, run_id: str) -> dict[str, Any]:
        response = await self._request("GET", f"/v1/agent-runs/{run_id}")
        return response.json()

    async def run_result(self, run_id: str, fmt: str) -> str:
        response = await self._request(
            "GET", f"/v1/agent-runs/{run_id}/result?format={fmt}"
        )
        return response.text


def _print_error(response: httpx.Response) -> None:
    try:
        payload = response.json()
    except ValueError:
        payload = response.text
    print(
        json.dumps(
            {
                "status_code": response.status_code,
                "error": payload,
            },
            indent=2,
        ),
        file=sys.stderr,
    )


def _print_transport_error(exc: httpx.RequestError, url: str) -> None:
    print(
        json.dumps(
            {
                "error": "request_failed",
                "message": str(exc),
                "url": url,
            },
            indent=2,
        ),
        file=sys.stderr,
    )


def _parse_skills(skills_arg: str | None) -> list[str]:
    if not skills_arg:
        return []
    return [item.strip() for item in skills_arg.split(",") if item.strip()]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Synapse public API CLI")
    parser.add_argument(
        "--base-url",
        default=os.getenv("SYNAPSE_BASE_URL", "http://localhost:8000"),
        help="API base URL (default: %(default)s or SYNAPSE_BASE_URL)",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("SYNAPSE_API_KEY"),
        help="Integration API key (or SYNAPSE_API_KEY)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="HTTP timeout in seconds (default: %(default)s)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    run_cmd = sub.add_parser("run", help="Create a new agent run")
    run_cmd.add_argument("message", help="User message")
    run_cmd.add_argument("--skills", help="Comma-separated skill names")
    run_cmd.add_argument("--planner", action="store_true", help="Use planner mode")
    run_cmd.add_argument(
        "--idempotency-key",
        help="Stable key used to safely retry this run creation request",
    )

    msg_cmd = sub.add_parser("message", help="Post a follow-up message")
    msg_cmd.add_argument("conversation_id", help="Conversation UUID")
    msg_cmd.add_argument("message", help="User message")
    msg_cmd.add_argument("--skills", help="Comma-separated skill names")
    msg_cmd.add_argument("--planner", action="store_true", help="Use planner mode")
    msg_cmd.add_argument(
        "--idempotency-key",
        help="Stable key used to safely retry this message request",
    )

    status_cmd = sub.add_parser("status", help="Get run status")
    status_cmd.add_argument("run_id", help="Run UUID")

    result_cmd = sub.add_parser("result", help="Get run result")
    result_cmd.add_argument("run_id", help="Run UUID")
    result_cmd.add_argument(
        "--format",
        choices=("json", "text", "markdown", "html"),
        default="json",
    )

    return parser


def _validate_uuid(value: str, label: str) -> None:
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise SystemExit(f"{label} must be a valid UUID: {value}") from exc


async def _run(args: argparse.Namespace) -> int:
    if not args.api_key:
        print("Missing API key. Set --api-key or SYNAPSE_API_KEY.", file=sys.stderr)
        return 2

    client = PublicApiClient(
        base_url=args.base_url,
        api_key=args.api_key,
        timeout=args.timeout,
    )

    if args.command == "run":
        payload = await client.create_run(
            args.message,
            skills=_parse_skills(args.skills),
            use_planner=True if args.planner else None,
            idempotency_key=args.idempotency_key,
        )
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "message":
        _validate_uuid(args.conversation_id, "conversation_id")
        payload = await client.create_message(
            args.conversation_id,
            args.message,
            skills=_parse_skills(args.skills),
            use_planner=True if args.planner else None,
            idempotency_key=args.idempotency_key,
        )
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "status":
        _validate_uuid(args.run_id, "run_id")
        payload = await client.run_status(args.run_id)
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "result":
        _validate_uuid(args.run_id, "run_id")
        payload = await client.run_result(args.run_id, args.format)
        if args.format == "json":
            print(json.dumps(json.loads(payload), indent=2))
        else:
            print(payload)
        return 0

    raise SystemExit(f"Unsupported command: {args.command}")


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
