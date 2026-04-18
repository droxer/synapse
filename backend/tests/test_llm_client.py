import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from agent.llm.client import (
    AnthropicClient,
    PromptCacheControl,
    PromptTextBlock,
    _extract_tool_calls,
    format_llm_failure,
    is_content_policy_error,
    render_system_prompt,
)


class _ToolUseBlock:
    def __init__(self, *, input_payload: dict, arguments: str | None = None) -> None:
        self.type = "tool_use"
        self.id = "tool_1"
        self.name = "file_write"
        self.input = input_payload
        if arguments is not None:
            self.arguments = arguments


class _CapturingMessagesAPI:
    def __init__(self) -> None:
        self.last_kwargs: dict | None = None

    async def create(self, **kwargs):
        self.last_kwargs = kwargs
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="ok")],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )


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


@pytest.mark.asyncio
async def test_create_message_serializes_structured_system_blocks():
    messages_api = _CapturingMessagesAPI()
    client = AnthropicClient.__new__(AnthropicClient)
    client._default_model = "test-model"
    client._default_max_tokens = 1024
    client._client = SimpleNamespace(messages=messages_api)

    response = await client.create_message(
        system=(
            PromptTextBlock(
                text="base",
                cache_control=PromptCacheControl(type="ephemeral"),
            ),
            PromptTextBlock(text="dynamic"),
        ),
        messages=[{"role": "user", "content": "hi"}],
        request_cache_control=PromptCacheControl(type="ephemeral"),
    )

    assert response.text == "ok"
    assert messages_api.last_kwargs is not None
    assert messages_api.last_kwargs["system"] == [
        {
            "type": "text",
            "text": "base",
            "cache_control": {"type": "ephemeral"},
        },
        {"type": "text", "text": "dynamic"},
    ]
    assert messages_api.last_kwargs["cache_control"] == {"type": "ephemeral"}


def test_render_system_prompt_flattens_structured_blocks() -> None:
    text = render_system_prompt(
        (
            PromptTextBlock(text="base"),
            PromptTextBlock(text="dynamic"),
        )
    )

    assert text == "base\n\ndynamic"


def test_anthropic_client_uses_httpx_client_without_env_proxies(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeAsyncAnthropic:
        def __init__(self, **kwargs) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(anthropic, "AsyncAnthropic", _FakeAsyncAnthropic)

    client = AnthropicClient(api_key="test-key")

    assert "http_client" not in captured
    assert client.default_model == "claude-sonnet-4-20250514"
