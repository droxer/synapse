"""Bridge between MCP tools and HiAgent's tool system."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from agent.mcp.client import MCPCallResult, MCPClient, MCPToolSchema
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult


def mcp_server_tag(server_key: str) -> str:
    """Return the stable registry tag for a specific MCP server instance."""
    return f"mcp_server:{server_key}"


def _sanitize_tool_part(value: str) -> str:
    """Normalize a tool-name fragment to ASCII-safe characters."""
    sanitized = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return sanitized or "mcp"


def _tool_prefix(server_name: str, server_key: str) -> str:
    """Build a collision-resistant tool prefix for an MCP server instance."""
    base = _sanitize_tool_part(server_name)
    if server_key == server_name and base == server_name:
        return base

    digest = hashlib.sha1(server_key.encode("utf-8")).hexdigest()[:10]
    return f"{base}_{digest}"


class MCPBridgedTool(LocalTool):
    """A LocalTool that proxies calls to an MCP server.

    Each instance wraps a single MCP tool discovered from a server.
    The registered tool name is prefixed with the server name
    (``<server>__<tool>``) to avoid collisions across servers.
    """

    def __init__(
        self,
        schema: MCPToolSchema,
        client: MCPClient,
        server_key: str | None = None,
    ) -> None:
        self._schema = schema
        self._client = client
        self._server_key = server_key or schema.server_name

    def definition(self) -> ToolDefinition:
        prefixed_name = (
            f"{_tool_prefix(self._schema.server_name, self._server_key)}"
            f"__{_sanitize_tool_part(self._schema.name)}"
        )
        return ToolDefinition(
            name=prefixed_name,
            description=self._schema.description,
            input_schema=self._schema.input_schema,
            execution_context=ExecutionContext.LOCAL,
            tags=("mcp", self._schema.server_name, mcp_server_tag(self._server_key)),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        result: MCPCallResult = await self._client.call_tool(self._schema.name, kwargs)
        if result.is_error:
            return ToolResult.fail(result.content)
        return ToolResult.ok(
            result.content,
            metadata={"mcp_server": self._schema.server_name},
        )
