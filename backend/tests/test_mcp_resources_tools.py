"""Tests for MCP resources/prompts clients and local tool wrappers."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.models import MCPState
from agent.mcp.client import (
    MCPPromptArgumentSchema,
    MCPPromptResult,
    MCPPromptSchema,
    MCPResourceReadResult,
    MCPResourceSchema,
    MCPResourceTemplateSchema,
    MCPStdioClient,
    _extract_text_content,
)
from agent.mcp.sse_client import MCPSSEClient
from agent.tools.local.mcp_resources import (
    MCPGetPrompt,
    MCPListPrompts,
    MCPListResources,
    MCPReadResource,
)


class _FakeResourceClient:
    async def connect(self) -> None:
        return None

    async def list_tools(self) -> tuple[()]:
        return ()

    async def list_resources(self) -> tuple[MCPResourceSchema, ...]:
        return (
            MCPResourceSchema(
                uri="file://guide.txt",
                name="Guide",
                description="Workspace guide",
                mime_type="text/plain",
                server_name="docs",
            ),
        )

    async def list_resource_templates(self) -> tuple[MCPResourceTemplateSchema, ...]:
        return (
            MCPResourceTemplateSchema(
                uri_template="file://reports/{id}.txt",
                name="Report",
                description="Report template",
                mime_type="text/plain",
                server_name="docs",
            ),
        )

    async def read_resource(self, uri: str) -> MCPResourceReadResult:
        return MCPResourceReadResult(
            content=f"read:{uri}",
            mime_type="text/plain",
        )

    async def list_prompts(self) -> tuple[MCPPromptSchema, ...]:
        return (
            MCPPromptSchema(
                name="summary",
                description="Summarize a report",
                arguments=(
                    MCPPromptArgumentSchema(
                        name="topic",
                        description="Report topic",
                        required=True,
                    ),
                ),
                server_name="docs",
            ),
        )

    async def get_prompt(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> MCPPromptResult:
        return MCPPromptResult(content=f"prompt:{name}:{arguments or {}}")

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        raise AssertionError(f"Unexpected MCP tool call: {name} {arguments}")

    async def close(self) -> None:
        return None

    def is_alive(self) -> bool:
        return True


def test_extract_text_content_renders_text_and_binary_blocks() -> None:
    rendered = _extract_text_content(
        [
            {"type": "text", "text": "Hello"},
            {
                "uri": "file://image.png",
                "mimeType": "image/png",
                "blob": "abc123",
            },
        ]
    )

    assert (
        rendered == "Hello\n\n[binary resource: file://image.png (image/png), 6 chars]"
    )


@pytest.mark.asyncio
async def test_stdio_and_sse_clients_support_resources_and_prompts() -> None:
    stdio_client = MCPStdioClient(command="echo", server_name="docs")
    stdio_client._send_request = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            {
                "resources": [
                    {
                        "uri": "file://guide.txt",
                        "name": "Guide",
                        "description": "Workspace guide",
                        "mimeType": "text/plain",
                    }
                ]
            },
            {
                "resourceTemplates": [
                    {
                        "uriTemplate": "file://reports/{id}.txt",
                        "name": "Report",
                        "description": "Report template",
                        "mimeType": "text/plain",
                    }
                ]
            },
            {
                "contents": [
                    {
                        "uri": "file://guide.txt",
                        "mimeType": "text/plain",
                        "text": "hello from MCP",
                    }
                ]
            },
            {
                "prompts": [
                    {
                        "name": "summary",
                        "description": "Summarize content",
                        "arguments": [
                            {
                                "name": "topic",
                                "description": "Topic name",
                                "required": True,
                            }
                        ],
                    }
                ]
            },
        ]
    )

    resources = await stdio_client.list_resources()
    templates = await stdio_client.list_resource_templates()
    resource = await stdio_client.read_resource("file://guide.txt")
    prompts = await stdio_client.list_prompts()

    assert resources[0].uri == "file://guide.txt"
    assert templates[0].uri_template == "file://reports/{id}.txt"
    assert resource.content == "hello from MCP"
    assert resource.mime_type == "text/plain"
    assert prompts[0].arguments[0].name == "topic"

    sse_client = MCPSSEClient(url="https://example.com/mcp", server_name="docs")
    sse_client._send_request = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "messages": [
                {
                    "role": "system",
                    "content": [{"type": "text", "text": "Use a formal tone."}],
                },
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "Summarize the roadmap."}],
                },
            ]
        }
    )

    prompt = await sse_client.get_prompt("summary", {"topic": "roadmap"})

    assert (
        prompt.content == "[system] Use a formal tone.\n\n[user] Summarize the roadmap."
    )


@pytest.mark.asyncio
async def test_mcp_resource_tools_resolve_namespaced_servers() -> None:
    state = MCPState(clients={"user-1:docs": _FakeResourceClient()})

    resources_result = await MCPListResources(state).execute(server="docs")
    read_result = await MCPReadResource(state).execute(
        server="docs",
        uri="file://guide.txt",
    )
    prompts_result = await MCPListPrompts(state).execute(server="docs")
    prompt_result = await MCPGetPrompt(state).execute(
        server="docs",
        name="summary",
        arguments={"topic": "roadmap"},
    )

    assert resources_result.success
    resources_payload = json.loads(resources_result.output)
    assert resources_payload == {
        "resources": [
            {
                "server": "user-1:docs",
                "uri": "file://guide.txt",
                "name": "Guide",
                "description": "Workspace guide",
                "mime_type": "text/plain",
            }
        ],
        "resource_templates": [
            {
                "server": "user-1:docs",
                "uri_template": "file://reports/{id}.txt",
                "name": "Report",
                "description": "Report template",
                "mime_type": "text/plain",
            }
        ],
    }

    assert read_result.success
    assert read_result.output == "read:file://guide.txt"
    assert read_result.metadata == {
        "server": "user-1:docs",
        "uri": "file://guide.txt",
        "mime_type": "text/plain",
    }

    assert prompts_result.success
    prompts_payload = json.loads(prompts_result.output)
    assert prompts_payload == {
        "prompts": [
            {
                "server": "user-1:docs",
                "name": "summary",
                "description": "Summarize a report",
                "arguments": [
                    {
                        "name": "topic",
                        "description": "Report topic",
                        "required": True,
                    }
                ],
            }
        ]
    }

    assert prompt_result.success
    assert prompt_result.output == "prompt:summary:{'topic': 'roadmap'}"
    assert prompt_result.metadata == {
        "server": "user-1:docs",
        "name": "summary",
    }
