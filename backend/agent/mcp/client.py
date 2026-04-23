"""MCP client for connecting to external tool servers."""

from __future__ import annotations

import types
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

# Default MCP protocol version.
MCP_PROTOCOL_VERSION = "2025-03-26"


@dataclass(frozen=True)
class MCPToolSchema:
    """Immutable MCP tool definition from a server."""

    name: str
    description: str
    input_schema: types.MappingProxyType[str, Any]
    server_name: str


@dataclass(frozen=True)
class MCPResourceSchema:
    """Immutable MCP resource descriptor."""

    uri: str
    name: str
    description: str
    mime_type: str | None
    server_name: str


@dataclass(frozen=True)
class MCPResourceTemplateSchema:
    """Immutable MCP resource template descriptor."""

    uri_template: str
    name: str
    description: str
    mime_type: str | None
    server_name: str


@dataclass(frozen=True)
class MCPPromptArgumentSchema:
    """Immutable MCP prompt argument descriptor."""

    name: str
    description: str
    required: bool


@dataclass(frozen=True)
class MCPPromptSchema:
    """Immutable MCP prompt descriptor."""

    name: str
    description: str
    arguments: tuple[MCPPromptArgumentSchema, ...]
    server_name: str


@dataclass(frozen=True)
class MCPCallResult:
    """Immutable result of calling an MCP tool."""

    content: str
    is_error: bool = False


@dataclass(frozen=True)
class MCPResourceReadResult:
    """Immutable result of reading an MCP resource."""

    content: str
    mime_type: str | None = None
    is_error: bool = False


@dataclass(frozen=True)
class MCPPromptResult:
    """Immutable result of retrieving an MCP prompt."""

    content: str
    is_error: bool = False


def _extract_text_content(parts: list[dict[str, Any]]) -> str:
    """Flatten mixed MCP content blocks into a readable text form."""
    text_parts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            text = str(part.get("text", "")).strip()
            if text:
                text_parts.append(text)
            continue
        if "text" in part:
            text = str(part.get("text", "")).strip()
            if text:
                text_parts.append(text)
            continue
        if "uri" in part:
            uri = str(part.get("uri", "")).strip()
            mime_type = str(part.get("mimeType", "")).strip()
            blob = str(part.get("blob", "")).strip()
            if blob:
                size_hint = len(blob)
                text_parts.append(
                    f"[binary resource: {uri or 'inline'}"
                    f"{f' ({mime_type})' if mime_type else ''}, {size_hint} chars]"
                )
    return "\n\n".join(text_parts)


@runtime_checkable
class MCPClient(Protocol):
    """Protocol defining the shared interface for MCP clients."""

    async def connect(self) -> None: ...

    async def list_tools(self) -> tuple[MCPToolSchema, ...]: ...

    async def list_resources(self) -> tuple[MCPResourceSchema, ...]: ...

    async def list_resource_templates(
        self,
    ) -> tuple[MCPResourceTemplateSchema, ...]: ...

    async def read_resource(self, uri: str) -> MCPResourceReadResult: ...

    async def list_prompts(self) -> tuple[MCPPromptSchema, ...]: ...

    async def get_prompt(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> MCPPromptResult: ...

    async def call_tool(
        self, name: str, arguments: dict[str, Any]
    ) -> MCPCallResult: ...

    async def close(self) -> None: ...

    def is_alive(self) -> bool: ...
