"""MCP client for connecting to external tool servers."""

from __future__ import annotations

import asyncio
import itertools
import json
import os
import types
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from loguru import logger

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


class MCPStdioClient:
    """MCP client that communicates with a server via stdio (JSON-RPC)."""

    def __init__(
        self,
        command: str,
        args: tuple[str, ...] = (),
        env: tuple[tuple[str, str], ...] = (),
        server_name: str = "",
        timeout: float = 30.0,
    ) -> None:
        self._command = command
        self._args = args
        self._env = env
        self._server_name = server_name
        self._timeout = timeout
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = itertools.count(1)
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None

    async def connect(self) -> None:
        """Start the MCP server process and perform initialization."""
        env = {**os.environ, **dict(self._env)}
        self._process = await asyncio.create_subprocess_exec(
            self._command,
            *self._args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        self._reader_task = asyncio.create_task(self._read_responses())
        self._stderr_task = asyncio.create_task(self._drain_stderr())

        # Initialize the MCP connection; clean up on failure so we don't leak
        # the subprocess and background tasks.
        try:
            await self._send_request(
                "initialize",
                {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "synapse", "version": "0.1.0"},
                },
            )
            # Send initialized notification
            await self._send_notification("notifications/initialized", {})
        except Exception:
            await self.close()
            raise
        logger.info("mcp_connected server={}", self._server_name)

    async def list_tools(self) -> tuple[MCPToolSchema, ...]:
        """Request the list of available tools from the server."""
        result = await self._send_request("tools/list", {})
        tools = result.get("tools", [])
        return tuple(
            MCPToolSchema(
                name=t["name"],
                description=t.get("description", ""),
                input_schema=types.MappingProxyType(
                    t.get("inputSchema", {"type": "object", "properties": {}})
                ),
                server_name=self._server_name,
            )
            for t in tools
        )

    async def list_resources(self) -> tuple[MCPResourceSchema, ...]:
        """Request the list of available resources from the server."""
        result = await self._send_request("resources/list", {})
        resources = result.get("resources", [])
        return tuple(
            MCPResourceSchema(
                uri=r["uri"],
                name=r.get("name", r["uri"]),
                description=r.get("description", ""),
                mime_type=r.get("mimeType"),
                server_name=self._server_name,
            )
            for r in resources
        )

    async def list_resource_templates(self) -> tuple[MCPResourceTemplateSchema, ...]:
        """Request the list of available resource templates from the server."""
        result = await self._send_request("resources/templates/list", {})
        templates = result.get("resourceTemplates", [])
        return tuple(
            MCPResourceTemplateSchema(
                uri_template=t["uriTemplate"],
                name=t.get("name", t["uriTemplate"]),
                description=t.get("description", ""),
                mime_type=t.get("mimeType"),
                server_name=self._server_name,
            )
            for t in templates
        )

    async def read_resource(self, uri: str) -> MCPResourceReadResult:
        """Read a resource from the MCP server."""
        try:
            result = await self._send_request("resources/read", {"uri": uri})
            contents = result.get("contents", [])
            mime_type = None
            if contents and isinstance(contents[0], dict):
                mime_type = contents[0].get("mimeType")
            return MCPResourceReadResult(
                content=_extract_text_content(contents),
                mime_type=mime_type,
            )
        except Exception as exc:
            return MCPResourceReadResult(
                content=f"MCP resource read failed: {exc}",
                is_error=True,
            )

    async def list_prompts(self) -> tuple[MCPPromptSchema, ...]:
        """Request the list of available prompts from the server."""
        result = await self._send_request("prompts/list", {})
        prompts = result.get("prompts", [])
        parsed: list[MCPPromptSchema] = []
        for prompt in prompts:
            arguments = tuple(
                MCPPromptArgumentSchema(
                    name=arg.get("name", ""),
                    description=arg.get("description", ""),
                    required=bool(arg.get("required", False)),
                )
                for arg in prompt.get("arguments", [])
                if arg.get("name")
            )
            parsed.append(
                MCPPromptSchema(
                    name=prompt["name"],
                    description=prompt.get("description", ""),
                    arguments=arguments,
                    server_name=self._server_name,
                )
            )
        return tuple(parsed)

    async def get_prompt(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> MCPPromptResult:
        """Retrieve a prompt from the MCP server."""
        try:
            result = await self._send_request(
                "prompts/get",
                {"name": name, "arguments": arguments or {}},
            )
            messages = result.get("messages", [])
            prompt_parts: list[str] = []
            for message in messages:
                if not isinstance(message, dict):
                    continue
                role = str(message.get("role", "assistant"))
                content = message.get("content", [])
                if isinstance(content, list):
                    rendered = _extract_text_content(content)
                else:
                    rendered = str(content)
                prompt_parts.append(f"[{role}] {rendered}".strip())
            return MCPPromptResult(content="\n\n".join(prompt_parts))
        except Exception as exc:
            return MCPPromptResult(
                content=f"MCP prompt retrieval failed: {exc}",
                is_error=True,
            )

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> MCPCallResult:
        """Call a tool on the MCP server."""
        try:
            result = await self._send_request(
                "tools/call",
                {
                    "name": name,
                    "arguments": arguments,
                },
            )
            content_parts = result.get("content", [])
            text_parts = [
                p.get("text", "") for p in content_parts if p.get("type") == "text"
            ]
            is_error = result.get("isError", False)
            return MCPCallResult(
                content="\n".join(text_parts) if text_parts else json.dumps(result),
                is_error=is_error,
            )
        except Exception as exc:
            return MCPCallResult(content=f"MCP tool call failed: {exc}", is_error=True)

    async def close(self) -> None:
        """Shut down the MCP server process."""
        if self._stderr_task is not None:
            self._stderr_task.cancel()
        if self._reader_task is not None:
            self._reader_task.cancel()
        self._reject_pending("MCP client closed")
        if self._process is not None and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
        logger.info("mcp_disconnected server={}", self._server_name)

    def is_alive(self) -> bool:
        """Return True if the MCP server subprocess is still running."""
        if self._process is None:
            return False
        return self._process.returncode is None

    # -- Internal helpers ---------------------------------------------------

    def _reject_pending(self, reason: str) -> None:
        """Cancel all pending futures with an error."""
        pending = dict(self._pending)
        self._pending.clear()
        for future in pending.values():
            if not future.done():
                future.set_exception(RuntimeError(reason))

    async def _send_request(
        self, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Send a JSON-RPC request and wait for the response."""
        req_id = next(self._request_id)
        message = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        }
        future: asyncio.Future[dict[str, Any]] = (
            asyncio.get_running_loop().create_future()
        )
        self._pending[req_id] = future

        await self._write_message(message)

        try:
            return await asyncio.wait_for(future, timeout=self._timeout)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise TimeoutError(f"MCP request {method} timed out") from None

    async def _send_notification(self, method: str, params: dict[str, Any]) -> None:
        """Send a JSON-RPC notification (no response expected)."""
        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
        await self._write_message(message)

    async def _write_message(self, message: dict[str, Any]) -> None:
        """Write a JSON-RPC message to the process stdin."""
        if self._process is None or self._process.stdin is None:
            raise RuntimeError("MCP process not connected")
        data = json.dumps(message)
        self._process.stdin.write(f"{data}\n".encode())
        await self._process.stdin.drain()

    async def _read_responses(self) -> None:
        """Read JSON-RPC responses from the process stdout."""
        if self._process is None or self._process.stdout is None:
            return
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line.decode().strip())
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue

                req_id = msg.get("id")
                if req_id is not None and req_id in self._pending:
                    future = self._pending.pop(req_id)
                    if "error" in msg:
                        future.set_exception(RuntimeError(f"MCP error: {msg['error']}"))
                    else:
                        future.set_result(msg.get("result", {}))
                elif req_id is None and "method" in msg:
                    # Server-initiated notification (no id) — log at debug level.
                    logger.debug(
                        "mcp_notification server={} method={}",
                        self._server_name,
                        msg.get("method"),
                    )
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("mcp_reader_error server={} error={}", self._server_name, exc)
        finally:
            # Reader exited — reject any pending futures so callers don't hang.
            self._reject_pending(f"MCP reader stopped for server {self._server_name}")

    async def _drain_stderr(self) -> None:
        """Read and log stderr from the MCP server process to prevent buffer deadlock."""
        if self._process is None or self._process.stderr is None:
            return
        try:
            while True:
                line = await self._process.stderr.readline()
                if not line:
                    break
                logger.debug(
                    "mcp_stderr server={} line={}",
                    self._server_name,
                    line.decode(errors="replace").rstrip(),
                )
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug("mcp_stderr_error server={} error={}", self._server_name, exc)
