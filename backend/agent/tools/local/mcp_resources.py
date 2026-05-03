"""Generic MCP resource and prompt access tools."""

from __future__ import annotations

import json
from typing import Any

from agent.mcp.client import MCPClient
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from api.models import MCPState


def _visible_client_items(
    mcp_state: MCPState,
    user_id: Any | None,
) -> list[tuple[str, MCPClient]]:
    visible_keys = set(mcp_state.configs_for_user(user_id))
    return [
        (key, client)
        for key, client in mcp_state.clients.items()
        if key in visible_keys
    ]


def _resolve_client(
    mcp_state: MCPState,
    server: str,
    user_id: Any | None,
) -> tuple[str, MCPClient] | None:
    visible_clients = dict(_visible_client_items(mcp_state, user_id))

    if ":" in server and server in visible_clients:
        return server, visible_clients[server]

    if user_id is not None:
        user_server_key = mcp_state.user_key(user_id, server)
        client = visible_clients.get(user_server_key)
        if client is not None:
            return user_server_key, client

    client = visible_clients.get(server)
    if client is not None:
        return server, client

    for key, existing in visible_clients.items():
        if key.split(":", 1)[-1] == server:
            return key, existing
    return None


class MCPListResources(LocalTool):
    """List resources available on one or more MCP servers."""

    def __init__(self, mcp_state: MCPState, user_id: Any | None = None) -> None:
        self._mcp_state = mcp_state
        self._user_id = user_id

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="mcp_list_resources",
            title="MCP List Resources",
            description="List MCP resources and resource templates exposed by a server.",
            input_schema={
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "Optional server key or bare server name. Omit to query all connected servers.",
                    }
                },
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True},
            tags=("mcp", "resources"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        server = str(kwargs.get("server", "")).strip()
        if server:
            resolved = _resolve_client(self._mcp_state, server, self._user_id)
            if resolved is None:
                return ToolResult.fail(f"Unknown MCP server: {server}")
            targets = [resolved]
        else:
            targets = _visible_client_items(self._mcp_state, self._user_id)

        resources: list[dict[str, Any]] = []
        templates: list[dict[str, Any]] = []
        for server_key, client in targets:
            try:
                for resource in await client.list_resources():
                    resources.append(
                        {
                            "server": server_key,
                            "uri": resource.uri,
                            "name": resource.name,
                            "description": resource.description,
                            "mime_type": resource.mime_type,
                        }
                    )
                for template in await client.list_resource_templates():
                    templates.append(
                        {
                            "server": server_key,
                            "uri_template": template.uri_template,
                            "name": template.name,
                            "description": template.description,
                            "mime_type": template.mime_type,
                        }
                    )
            except Exception as exc:
                return ToolResult.fail(
                    f"Failed to list MCP resources for {server_key}: {exc}"
                )

        payload = {"resources": resources, "resource_templates": templates}
        return ToolResult.ok(json.dumps(payload, ensure_ascii=False), metadata=payload)


class MCPReadResource(LocalTool):
    """Read a specific MCP resource."""

    def __init__(self, mcp_state: MCPState, user_id: Any | None = None) -> None:
        self._mcp_state = mcp_state
        self._user_id = user_id

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="mcp_read_resource",
            title="MCP Read Resource",
            description="Read the contents of an MCP resource by server and URI.",
            input_schema={
                "type": "object",
                "properties": {
                    "server": {"type": "string"},
                    "uri": {"type": "string"},
                },
                "required": ["server", "uri"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True},
            tags=("mcp", "resources"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        server = str(kwargs.get("server", "")).strip()
        uri = str(kwargs.get("uri", "")).strip()
        if not server or not uri:
            return ToolResult.fail("server and uri must not be empty")
        resolved = _resolve_client(self._mcp_state, server, self._user_id)
        if resolved is None:
            return ToolResult.fail(f"Unknown MCP server: {server}")
        server_key, client = resolved
        result = await client.read_resource(uri)
        if result.is_error:
            return ToolResult.fail(result.content)
        metadata = {"server": server_key, "uri": uri, "mime_type": result.mime_type}
        return ToolResult.ok(result.content, metadata=metadata)


class MCPListPrompts(LocalTool):
    """List prompts available on one or more MCP servers."""

    def __init__(self, mcp_state: MCPState, user_id: Any | None = None) -> None:
        self._mcp_state = mcp_state
        self._user_id = user_id

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="mcp_list_prompts",
            title="MCP List Prompts",
            description="List reusable prompts exposed by MCP servers.",
            input_schema={
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "Optional server key or bare name. Omit to query all connected servers.",
                    }
                },
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True},
            tags=("mcp", "prompts"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        server = str(kwargs.get("server", "")).strip()
        if server:
            resolved = _resolve_client(self._mcp_state, server, self._user_id)
            if resolved is None:
                return ToolResult.fail(f"Unknown MCP server: {server}")
            targets = [resolved]
        else:
            targets = _visible_client_items(self._mcp_state, self._user_id)

        prompts: list[dict[str, Any]] = []
        for server_key, client in targets:
            try:
                for prompt in await client.list_prompts():
                    prompts.append(
                        {
                            "server": server_key,
                            "name": prompt.name,
                            "description": prompt.description,
                            "arguments": [
                                {
                                    "name": arg.name,
                                    "description": arg.description,
                                    "required": arg.required,
                                }
                                for arg in prompt.arguments
                            ],
                        }
                    )
            except Exception as exc:
                return ToolResult.fail(
                    f"Failed to list MCP prompts for {server_key}: {exc}"
                )

        payload = {"prompts": prompts}
        return ToolResult.ok(json.dumps(payload, ensure_ascii=False), metadata=payload)


class MCPGetPrompt(LocalTool):
    """Retrieve a specific MCP prompt."""

    def __init__(self, mcp_state: MCPState, user_id: Any | None = None) -> None:
        self._mcp_state = mcp_state
        self._user_id = user_id

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="mcp_get_prompt",
            title="MCP Get Prompt",
            description="Retrieve a prompt from an MCP server with optional argument values.",
            input_schema={
                "type": "object",
                "properties": {
                    "server": {"type": "string"},
                    "name": {"type": "string"},
                    "arguments": {
                        "type": "object",
                        "additionalProperties": True,
                    },
                },
                "required": ["server", "name"],
            },
            execution_context=ExecutionContext.LOCAL,
            annotations={"readOnlyHint": True},
            tags=("mcp", "prompts"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        server = str(kwargs.get("server", "")).strip()
        name = str(kwargs.get("name", "")).strip()
        arguments = kwargs.get("arguments", {})
        if not server or not name:
            return ToolResult.fail("server and name must not be empty")
        resolved = _resolve_client(self._mcp_state, server, self._user_id)
        if resolved is None:
            return ToolResult.fail(f"Unknown MCP server: {server}")
        server_key, client = resolved
        result = await client.get_prompt(
            name=name,
            arguments=arguments if isinstance(arguments, dict) else {},
        )
        if result.is_error:
            return ToolResult.fail(result.content)
        metadata = {"server": server_key, "name": name}
        return ToolResult.ok(result.content, metadata=metadata)
