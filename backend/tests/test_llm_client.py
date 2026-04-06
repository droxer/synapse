import json

import anthropic
import httpx

from agent.llm.client import (
    _extract_tool_calls,
    format_llm_failure,
    is_content_policy_error,
)


class _ToolUseBlock:
    def __init__(self, *, input_payload: dict, arguments: str | None = None) -> None:
        self.type = "tool_use"
        self.id = "tool_1"
        self.name = "file_write"
        self.input = input_payload
        if arguments is not None:
            self.arguments = arguments


def test_extract_tool_calls_uses_arguments_when_input_empty() -> None:
    args = {"path": "/tmp/a.txt", "content": "hello"}
    block = _ToolUseBlock(input_payload={}, arguments=json.dumps(args))

    calls = _extract_tool_calls([block])

    assert len(calls) == 1
    assert calls[0].input == args


def test_extract_tool_calls_merges_partial_input_with_arguments() -> None:
    args = {
        "command": "python /workspace/make_chart.py",
        "output_files": ["/workspace/chart.png"],
    }
    block = _ToolUseBlock(
        input_payload={"command": "python /workspace/make_chart.py"},
        arguments=json.dumps(args),
    )

    calls = _extract_tool_calls([block])

    assert len(calls) == 1
    assert calls[0].input == args


def test_format_llm_failure_normalizes_content_policy_rejection() -> None:
    payload = {
        "error": {
            "message": "Input data may contain inappropriate content.",
            "type": "data_inspection_failed",
            "code": "data_inspection_failed",
        }
    }
    request = httpx.Request(
        "POST", "https://dashscope.aliyuncs.com/apps/anthropic/v1/messages"
    )
    response = httpx.Response(400, request=request, json=payload)
    exc = anthropic.BadRequestError(
        "Error code: 400 - data_inspection_failed",
        response=response,
        body=payload,
    )

    message = format_llm_failure(exc)

    assert is_content_policy_error(exc) is True
    assert is_content_policy_error(message) is True
    assert message.startswith("LLM content policy rejection:")
    assert "content inspection" in message
