"""MCP server configuration."""

from __future__ import annotations

from dataclasses import dataclass


_VALID_TRANSPORTS = frozenset({"sse", "streamablehttp"})

MCP_RESERVED_HTTP_HEADERS = frozenset(
    {
        "accept",
        "content-type",
        "mcp-protocol-version",
        "mcp-session-id",
    }
)


@dataclass(frozen=True)
class MCPServerConfig:
    """Immutable configuration for an MCP server connection.

    Attributes:
        name: Human-readable server name.
        transport: Connection method ("sse" or "streamablehttp").
        url: Server URL.
        headers: Extra HTTP headers for SSE and Streamable HTTP transports.
        timeout: Per-server request timeout in seconds.
    """

    name: str
    transport: str  # "sse" or "streamablehttp"
    url: str = ""
    headers: tuple[tuple[str, str], ...] = ()
    timeout: float = 30.0
    enabled: bool = True

    def __post_init__(self) -> None:
        if self.transport not in _VALID_TRANSPORTS:
            raise ValueError(
                f"Unsupported MCP transport {self.transport!r}; "
                f"expected one of {sorted(_VALID_TRANSPORTS)}"
            )
        if not self.url:
            raise ValueError(f"{self.transport} transport requires a url")
        for name, value in self.headers:
            _validate_http_header(name, value)


def _validate_http_header(name: str, value: str) -> None:
    """Validate a user-provided MCP HTTP header."""
    if not isinstance(name, str) or not isinstance(value, str):
        raise ValueError("MCP HTTP header names and values must be strings")
    if not name.strip():
        raise ValueError("MCP HTTP header names must not be empty")
    if "\n" in name or "\r" in name or "\n" in value or "\r" in value:
        raise ValueError("MCP HTTP headers must not contain newlines")
    if name.lower() in MCP_RESERVED_HTTP_HEADERS:
        raise ValueError(f"MCP HTTP header {name!r} is managed by Synapse")
