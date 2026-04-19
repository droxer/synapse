"""Lightweight JSON-schema-style validation for tool payloads."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any


class ToolSchemaValidationError(ValueError):
    """Raised when a tool payload violates its declared schema."""


def _json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return type(value).__name__


def _matches_type(value: Any, expected_type: str) -> bool:
    if expected_type == "null":
        return value is None
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "number":
        return (isinstance(value, int | float)) and not isinstance(value, bool)
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "object":
        return isinstance(value, dict)
    if expected_type == "array":
        return isinstance(value, list)
    return True


def _validate_type(value: Any, expected: str | Sequence[Any], path: str) -> None:
    if isinstance(expected, str):
        expected_types = (expected,)
    elif isinstance(expected, Sequence):
        expected_types = tuple(str(item) for item in expected)
    else:
        return

    if any(_matches_type(value, expected_type) for expected_type in expected_types):
        return
    expected_label = " | ".join(expected_types)
    actual = _json_type_name(value)
    raise ToolSchemaValidationError(
        f"{path} must be of type {expected_label}, got {actual}"
    )


def validate_schema(
    value: Any,
    schema: Mapping[str, Any] | None,
    *,
    path: str = "$",
) -> None:
    """Validate *value* against the supported subset of JSON Schema."""
    if not schema:
        return

    expected_type = schema.get("type")
    if expected_type is not None:
        _validate_type(value, expected_type, path)

    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and value not in enum_values:
        raise ToolSchemaValidationError(
            f"{path} must be one of {enum_values!r}, got {value!r}"
        )

    if value is None:
        return

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        if isinstance(properties, Mapping):
            required = schema.get("required", ())
            if isinstance(required, Sequence) and not isinstance(required, str):
                for field_name in required:
                    if (
                        isinstance(field_name, str)
                        and field_name
                        and field_name not in value
                    ):
                        raise ToolSchemaValidationError(
                            f"{path}.{field_name} is required"
                        )

            additional = schema.get("additionalProperties", True)
            for key, nested in value.items():
                nested_path = f"{path}.{key}"
                property_schema = properties.get(key)
                if isinstance(property_schema, Mapping):
                    validate_schema(nested, property_schema, path=nested_path)
                    continue
                if additional is False:
                    raise ToolSchemaValidationError(
                        f"{nested_path} is not allowed by the schema"
                    )
                if isinstance(additional, Mapping):
                    validate_schema(nested, additional, path=nested_path)
        return

    if isinstance(value, list):
        items = schema.get("items")
        if isinstance(items, Mapping):
            for index, nested in enumerate(value):
                validate_schema(nested, items, path=f"{path}[{index}]")


def parse_and_validate_json_output(
    output: str,
    schema: Mapping[str, Any] | None,
) -> Any:
    """Parse a JSON tool output string and validate it against *schema*."""
    if not schema:
        return output
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError as exc:
        raise ToolSchemaValidationError(
            f"output must be valid JSON: {exc.msg}"
        ) from exc
    validate_schema(parsed, schema, path="$")
    return parsed
