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
    _extract_text_content,
)
from agent.mcp.config import MCPServerConfig
from agent.mcp.sse_client import MCPSSEClient
from agent.tools.local.mcp_resources import (
    MCPGetPrompt,
    MCPListPrompts,
    MCPListResources,
    MCPReadResource,
)


class _FakeResourceClient:
    def __init__(self, label: str = "") -> None:
        self._label = label

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
        prefix = f"{self._label}:" if self._label else ""
        return MCPResourceReadResult(
            content=f"{prefix}read:{uri}",
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
        prefix = f"{self._label}:" if self._label else ""
        return MCPPromptResult(content=f"{prefix}prompt:{name}:{arguments or {}}")

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
async def test_http_client_supports_resources_and_prompts() -> None:
    http_client = MCPSSEClient(url="https://example.com/mcp", server_name="docs")
    http_client._send_request = AsyncMock(  # type: ignore[method-assign]
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

    resources = await http_client.list_resources()
    templates = await http_client.list_resource_templates()
    resource = await http_client.read_resource("file://guide.txt")
    prompts = await http_client.list_prompts()

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
    state = MCPState(
        clients={"user-1:docs": _FakeResourceClient()},
        configs={
            "user-1:docs": MCPServerConfig(
                name="docs",
                transport="streamablehttp",
                url="https://example.com/user-1-docs",
            )
        },
    )

    resources_result = await MCPListResources(state, user_id="user-1").execute(
        server="docs"
    )
    read_result = await MCPReadResource(state, user_id="user-1").execute(
        server="docs",
        uri="file://guide.txt",
    )
    prompts_result = await MCPListPrompts(state, user_id="user-1").execute(
        server="docs"
    )
    prompt_result = await MCPGetPrompt(state, user_id="user-1").execute(
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


@pytest.mark.asyncio
async def test_mcp_resource_tools_scope_visible_clients_and_prefer_current_user() -> (
    None
):
    state = MCPState(
        clients={
            "docs": _FakeResourceClient("global"),
            "user-1:docs": _FakeResourceClient("user-1"),
            "user-2:docs": _FakeResourceClient("user-2"),
        },
        configs={
            "docs": MCPServerConfig(
                name="docs",
                transport="streamablehttp",
                url="https://example.com/global-docs",
            ),
            "user-1:docs": MCPServerConfig(
                name="docs",
                transport="streamablehttp",
                url="https://example.com/user-1-docs",
            ),
            "user-2:docs": MCPServerConfig(
                name="docs",
                transport="streamablehttp",
                url="https://example.com/user-2-docs",
            ),
        },
    )

    resources_result = await MCPListResources(state, user_id="user-1").execute()
    resources_payload = json.loads(resources_result.output)
    visible_servers = {
        resource["server"] for resource in resources_payload["resources"]
    }
    read_result = await MCPReadResource(state, user_id="user-1").execute(
        server="docs",
        uri="file://guide.txt",
    )
    prompts_result = await MCPListPrompts(state, user_id="user-1").execute()
    prompts_payload = json.loads(prompts_result.output)
    visible_prompt_servers = {prompt["server"] for prompt in prompts_payload["prompts"]}
    prompt_result = await MCPGetPrompt(state, user_id="user-1").execute(
        server="docs",
        name="summary",
    )
    peer_result = await MCPReadResource(state, user_id="user-1").execute(
        server="user-2:docs",
        uri="file://guide.txt",
    )
    peer_prompt_result = await MCPGetPrompt(state, user_id="user-1").execute(
        server="user-2:docs",
        name="summary",
    )
    anonymous_result = await MCPReadResource(state).execute(
        server="user-1:docs",
        uri="file://guide.txt",
    )
    anonymous_prompt_result = await MCPGetPrompt(state).execute(
        server="user-1:docs",
        name="summary",
    )

    assert resources_result.success
    assert visible_servers == {"docs", "user-1:docs"}
    assert read_result.success
    assert read_result.output == "user-1:read:file://guide.txt"
    assert prompts_result.success
    assert visible_prompt_servers == {"docs", "user-1:docs"}
    assert prompt_result.success
    assert prompt_result.output == "user-1:prompt:summary:{}"
    assert not peer_result.success
    assert peer_result.error is not None
    assert "Unknown MCP server" in peer_result.error
    assert not peer_prompt_result.success
    assert peer_prompt_result.error is not None
    assert "Unknown MCP server" in peer_prompt_result.error
    assert not anonymous_result.success
    assert anonymous_result.error is not None
    assert "Unknown MCP server" in anonymous_result.error
    assert not anonymous_prompt_result.success
    assert anonymous_prompt_result.error is not None
    assert "Unknown MCP server" in anonymous_prompt_result.error
