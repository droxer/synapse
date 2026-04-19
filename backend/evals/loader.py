"""YAML eval case parsing and validation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from evals.models import EvalCase, GradingCriteria

_VALID_GRADING_MODES = frozenset({"programmatic", "llm_judge", "both"})

_VALID_CRITERIA_TYPES = frozenset(
    {
        "tool_used",
        "tool_not_used",
        "output_regex",
        "output_contains",
        "max_iterations",
        "no_errors",
        "skill_activated",
        "agent_spawned",
        "agent_handoff",
        "tool_call_count",
        "context_compacted",
        "tool_not_repeated",
        "execution_shape",
    }
)


class LoadError(Exception):
    """Raised when an eval case file is invalid."""


def _parse_criteria(raw_list: list[dict[str, Any]]) -> tuple[GradingCriteria, ...]:
    """Parse a list of raw criterion dicts into frozen GradingCriteria."""
    results: list[GradingCriteria] = []
    for item in raw_list:
        name = item.get("name")
        ctype = item.get("type")
        if not name or not ctype:
            raise LoadError(f"Criterion missing 'name' or 'type': {item}")
        if ctype not in _VALID_CRITERIA_TYPES:
            raise LoadError(
                f"Invalid criterion type '{ctype}'. "
                f"Must be one of: {sorted(_VALID_CRITERIA_TYPES)}"
            )
        results.append(
            GradingCriteria(
                name=name,
                type=ctype,
                value=item.get("value"),
                weight=float(item.get("weight", 1.0)),
            )
        )
    return tuple(results)


def _parse_mock_responses(
    raw: Any,
) -> tuple[dict[str, Any], ...] | None:
    """Parse optional mock_responses list into a validated tuple of dicts."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise LoadError("'mock_responses' must be a list")

    parsed: list[dict[str, Any]] = []
    for response_index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise LoadError(
                f"'mock_responses[{response_index}]' must be a mapping, "
                f"got {type(item).__name__}"
            )

        response: dict[str, Any] = {}
        for field in ("text", "stop_reason", "thinking"):
            value = item.get(field)
            if value is not None:
                if not isinstance(value, str):
                    raise LoadError(
                        f"'mock_responses[{response_index}].{field}' must be a string"
                    )
                response[field] = value

        tool_calls = item.get("tool_calls")
        if tool_calls is not None:
            if not isinstance(tool_calls, list):
                raise LoadError(
                    f"'mock_responses[{response_index}].tool_calls' must be a list"
                )
            parsed_tool_calls: list[dict[str, Any]] = []
            for tool_call_index, tool_call in enumerate(tool_calls):
                if not isinstance(tool_call, dict):
                    raise LoadError(
                        f"'mock_responses[{response_index}].tool_calls"
                        f"[{tool_call_index}]' must be a mapping"
                    )
                name = tool_call.get("name")
                if not isinstance(name, str) or not name:
                    raise LoadError(
                        f"'mock_responses[{response_index}].tool_calls"
                        f"[{tool_call_index}].name' must be a non-empty string"
                    )
                parsed_tool_call: dict[str, Any] = {"name": name}
                tool_id = tool_call.get("id")
                if tool_id is not None:
                    if not isinstance(tool_id, str):
                        raise LoadError(
                            f"'mock_responses[{response_index}].tool_calls"
                            f"[{tool_call_index}].id' must be a string"
                        )
                    parsed_tool_call["id"] = tool_id
                tool_input = tool_call.get("input")
                if tool_input is not None:
                    if not isinstance(tool_input, dict):
                        raise LoadError(
                            f"'mock_responses[{response_index}].tool_calls"
                            f"[{tool_call_index}].input' must be a mapping"
                        )
                    parsed_tool_call["input"] = tool_input
                parsed_tool_calls.append(parsed_tool_call)
            response["tool_calls"] = parsed_tool_calls

        usage = item.get("usage")
        if usage is not None:
            if not isinstance(usage, dict):
                raise LoadError(
                    f"'mock_responses[{response_index}].usage' must be a mapping"
                )
            parsed_usage: dict[str, int] = {}
            for token_field in ("input_tokens", "output_tokens"):
                token_value = usage.get(token_field)
                if token_value is not None:
                    if not isinstance(token_value, int):
                        raise LoadError(
                            f"'mock_responses[{response_index}].usage.{token_field}' "
                            f"must be an integer"
                        )
                    parsed_usage[token_field] = token_value
            response["usage"] = parsed_usage

        parsed.append(response)

    return tuple(parsed)


def load_case(path: Path) -> EvalCase:
    """Load a single eval case from a YAML file.

    Raises:
        LoadError: If required fields are missing or invalid.
    """
    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise LoadError(f"Expected a YAML mapping in {path}, got {type(data).__name__}")

    required = ("id", "name", "description", "user_message", "grading_mode", "criteria")
    for field in required:
        if field not in data:
            raise LoadError(f"Missing required field '{field}' in {path}")

    grading_mode = data["grading_mode"]
    if grading_mode not in _VALID_GRADING_MODES:
        raise LoadError(
            f"Invalid grading_mode '{grading_mode}' in {path}. "
            f"Must be one of: {sorted(_VALID_GRADING_MODES)}"
        )

    criteria_raw = data["criteria"]
    if not isinstance(criteria_raw, list) or not criteria_raw:
        raise LoadError(f"'criteria' must be a non-empty list in {path}")

    tags_raw = data.get("tags", [])
    if not isinstance(tags_raw, list):
        raise LoadError(f"'tags' must be a list in {path}")

    return EvalCase(
        id=str(data["id"]),
        name=str(data["name"]),
        description=str(data["description"]),
        user_message=str(data["user_message"]),
        grading_mode=grading_mode,
        criteria=_parse_criteria(criteria_raw),
        llm_judge_prompt=data.get("llm_judge_prompt"),
        expected_output_hint=data.get("expected_output_hint"),
        tags=tuple(str(t) for t in tags_raw),
        max_iterations=int(data.get("max_iterations", 50)),
        token_budget=int(data.get("token_budget", 0)),
        mock_responses=_parse_mock_responses(data.get("mock_responses")),
    )


def load_cases(
    directory: Path,
    case_id: str | None = None,
    tags: tuple[str, ...] = (),
) -> tuple[EvalCase, ...]:
    """Load all eval cases from a directory, with optional filtering.

    Args:
        directory: Path to the cases directory.
        case_id: If set, only load the case with this id.
        tags: If non-empty, only load cases that have at least one matching tag.

    Returns:
        Tuple of loaded and filtered EvalCase objects.

    Raises:
        LoadError: If any YAML file is invalid.
        FileNotFoundError: If the directory does not exist.
    """
    if not directory.is_dir():
        raise FileNotFoundError(f"Cases directory not found: {directory}")

    yaml_files = sorted(directory.glob("*.yaml"))
    if not yaml_files:
        raise LoadError(f"No YAML files found in {directory}")

    cases: list[EvalCase] = []
    for yaml_path in yaml_files:
        case = load_case(yaml_path)

        if case_id is not None and case.id != case_id:
            continue

        if tags and not set(tags) & set(case.tags):
            continue

        cases.append(case)

    return tuple(cases)
