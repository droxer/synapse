"""MCP client for HTTP-based transports (Streamable HTTP and legacy SSE)."""

from __future__ import annotations

import asyncio
import itertools
import json
import types
from typing import Any

import httpx
from loguru import logger

from agent.mcp.client import MCP_PROTOCOL_VERSION, MCPCallResult, MCPToolSchema


def _parse_sse_events(text: str) -> list[tuple[str, str]]:
    """Parse SSE text into a list of (event_type, data) tuples."""
    events: list[tuple[str, str]] = []
    event_type = "message"
    data_lines: list[str] = []

    for raw_line in text.split("\n"):
        line = raw_line.rstrip("\r")
        if not line:
            if data_lines:
                events.append((event_type, "\n".join(data_lines)))
                event_type = "message"
                data_lines = []
            continue
        if line.startswith("event:"):
            event_type = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:") :].strip())

    # Flush trailing event without final newline.
    if data_lines:
        events.append((event_type, "\n".join(data_lines)))

    return events


class MCPSSEClient:
    """MCP client supporting both Streamable HTTP and legacy SSE transports.

    **Streamable HTTP** (modern, MCP spec 2025-03-26):
      POST JSON-RPC to the URL; response Content-Type is ``text/event-stream``
      with JSON-RPC results embedded in SSE ``message`` events.  Session
      continuity is maintained via the ``Mcp-Session-Id`` header.

    **Legacy SSE**:
      GET ``{url}/sse`` opens a long-lived stream; the first ``endpoint``
      event tells the client where to POST JSON-RPC messages.

    The client auto-detects: it first tries Streamable HTTP (POST to the URL).
    If the server returns 404/405 it falls back to legacy SSE.
    """

    def __init__(
        self,
        url: str,
        server_name: str = "",
        timeout: float = 30.0,
    ) -> None:
        self._url = url.rstrip("/")
        self._server_name = server_name
        self._timeout = timeout
        self._http: httpx.AsyncClient | None = None
        self._request_id = itertools.count(1)
        self._connected = False
        self._session_id: str | None = None

        # Legacy SSE state.
        self._legacy = False
        self._legacy_task: asyncio.Task[None] | None = None
        self._legacy_endpoint: str | None = None
        self._legacy_endpoint_ready = asyncio.Event()
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}

    # -- Public interface ---------------------------------------------------

    async def connect(self) -> None:
        """Connect and perform MCP initialization."""
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(self._timeout, connect=self._timeout),
        )

        # Try Streamable HTTP first (POST JSON-RPC to the URL).
        try:
            await self._streamable_initialize()
            self._connected = True
            logger.info("mcp_streamable_connected server={}", self._server_name)
            return
        except _StreamableNotSupported:
            logger.debug(
                "mcp_streamable_not_supported server={}, trying legacy SSE",
                self._server_name,
            )

        # Fall back to legacy SSE.
        # Try the URL as-is first (it may already point to the SSE endpoint),
        # then try appending /sse if the first attempt fails.
        self._legacy = True
        connected_legacy = False
        for sse_url in self._legacy_sse_urls():
            self._legacy_endpoint_ready.clear()
            self._legacy_endpoint = None
            self._legacy_task = asyncio.create_task(self._legacy_read_stream(sse_url))
            try:
                await asyncio.wait_for(
                    self._legacy_endpoint_ready.wait(),
                    timeout=min(self._timeout, 10.0),
                )
                connected_legacy = True
                break
            except asyncio.TimeoutError:
                self._legacy_task.cancel()
                logger.debug(
                    "mcp_legacy_sse_no_endpoint url={} server={}",
                    sse_url,
                    self._server_name,
                )

        if not connected_legacy:
            await self.close()
            raise TimeoutError(
                f"MCP server {self._server_name} not reachable via "
                f"Streamable HTTP or legacy SSE at {self._url}"
            )

        await self._legacy_send_request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "synapse", "version": "0.1.0"},
            },
        )
        await self._legacy_send_notification("notifications/initialized", {})
        self._connected = True
        logger.info("mcp_legacy_sse_connected server={}", self._server_name)

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

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> MCPCallResult:
        """Call a tool on the MCP server."""
        try:
            result = await self._send_request(
                "tools/call",
                {"name": name, "arguments": arguments},
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
        """Shut down the connection."""
        self._connected = False
        if self._legacy_task is not None:
            self._legacy_task.cancel()
        self._reject_pending("MCP SSE client closed")
        if self._http is not None:
            await self._http.aclose()
            self._http = None
        logger.info("mcp_sse_disconnected server={}", self._server_name)

    def is_alive(self) -> bool:
        """Return True if the client is connected."""
        if not self._connected:
            return False
        if self._legacy:
            return self._legacy_task is not None and not self._legacy_task.done()
        return True

    # -- Request dispatch ---------------------------------------------------

    async def _send_request(
        self, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        if self._legacy:
            return await self._legacy_send_request(method, params)
        return await self._streamable_send_request(method, params)

    # -- Streamable HTTP implementation -------------------------------------

    async def _streamable_initialize(self) -> None:
        """Perform MCP initialization using Streamable HTTP POST."""
        result = await self._streamable_send_request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "synapse", "version": "0.1.0"},
            },
        )
        if not result:
            raise _StreamableNotSupported
        # Send initialized notification (fire-and-forget).
        await self._streamable_send_notification("notifications/initialized", {})

    async def _streamable_send_request(
        self, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        if self._http is None:
            raise RuntimeError("MCP SSE client not connected")

        req_id = next(self._request_id)
        message = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        }
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._session_id is not None:
            headers["Mcp-Session-Id"] = self._session_id

        try:
            resp = await self._http.post(self._url, json=message, headers=headers)
        except httpx.HTTPError as exc:
            raise _StreamableNotSupported from exc

        if resp.status_code in (404, 405, 406):
            raise _StreamableNotSupported

        resp.raise_for_status()

        # Capture session ID from response.
        sid = resp.headers.get("mcp-session-id")
        if sid:
            self._session_id = sid

        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            return self._extract_result_from_sse(resp.text, req_id)
        # Plain JSON response.
        body = resp.json()
        if "error" in body:
            raise RuntimeError(f"MCP error: {body['error']}")
        return body.get("result", {})

    async def _streamable_send_notification(
        self, method: str, params: dict[str, Any]
    ) -> None:
        if self._http is None:
            raise RuntimeError("MCP SSE client not connected")
        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._session_id is not None:
            headers["Mcp-Session-Id"] = self._session_id
        try:
            resp = await self._http.post(self._url, json=message, headers=headers)
            # Notifications may return 200, 202, or 204; ignore body.
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Notifications are fire-and-forget per MCP spec — log but don't fail.
            logger.debug(
                "mcp_notification_error server={} method={} status={}",
                self._server_name,
                method,
                exc.response.status_code,
            )

    @staticmethod
    def _extract_result_from_sse(text: str, req_id: int) -> dict[str, Any]:
        """Parse SSE response body and extract the JSON-RPC result."""
        for event_type, data in _parse_sse_events(text):
            if event_type != "message":
                continue
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                continue
            if msg.get("id") == req_id:
                if "error" in msg:
                    raise RuntimeError(f"MCP error: {msg['error']}")
                return msg.get("result", {})
        raise RuntimeError(f"No JSON-RPC response for id={req_id} in SSE stream")

    # -- Legacy SSE implementation ------------------------------------------

    def _reject_pending(self, reason: str) -> None:
        pending = dict(self._pending)
        self._pending.clear()
        for future in pending.values():
            if not future.done():
                future.set_exception(RuntimeError(reason))

    async def _legacy_send_request(
        self, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
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
        await self._legacy_post(message)

        try:
            return await asyncio.wait_for(future, timeout=self._timeout)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise TimeoutError(f"MCP request {method} timed out") from None

    async def _legacy_send_notification(
        self, method: str, params: dict[str, Any]
    ) -> None:
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        await self._legacy_post(message)

    async def _legacy_post(self, message: dict[str, Any]) -> None:
        if self._http is None or self._legacy_endpoint is None:
            raise RuntimeError("MCP legacy SSE client not connected")
        resp = await self._http.post(
            self._legacy_endpoint,
            json=message,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()

    def _legacy_sse_urls(self) -> list[str]:
        """Return candidate URLs for the legacy SSE stream.

        The user-provided URL may already be the SSE endpoint (e.g.
        ``https://server.com/sse``), or it may be the base URL that
        requires ``/sse`` appended.  We try the URL as-is first.
        """
        urls = [self._url]
        if not self._url.endswith("/sse"):
            urls.append(f"{self._url}/sse")
        return urls

    async def _legacy_read_stream(self, sse_url: str) -> None:
        """Read the legacy SSE event stream from *sse_url*."""
        if self._http is None:
            return
        try:
            async with self._http.stream("GET", sse_url) as response:
                response.raise_for_status()
                event_type = ""
                data_lines: list[str] = []
                async for raw_line in response.aiter_lines():
                    line = raw_line.rstrip("\r\n")
                    if not line:
                        if data_lines:
                            data = "\n".join(data_lines)
                            self._legacy_handle_event(event_type or "message", data)
                            event_type = ""
                            data_lines = []
                        continue
                    if line.startswith("event:"):
                        event_type = line[len("event:") :].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[len("data:") :].strip())
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error(
                "mcp_sse_stream_error server={} error={}",
                self._server_name,
                exc,
            )
        finally:
            self._connected = False
            self._reject_pending(
                f"MCP SSE stream stopped for server {self._server_name}"
            )

    def _legacy_handle_event(self, event_type: str, data: str) -> None:
        if event_type == "endpoint":
            endpoint = data.strip()
            if endpoint.startswith("/"):
                # Relative path — resolve against the base URL (safe).
                self._legacy_endpoint = f"{self._url}{endpoint}"
            else:
                # Absolute URL — only accept if it shares the same origin as
                # self._url to prevent a malicious server from redirecting POST
                # traffic to an arbitrary internal or external host.
                from urllib.parse import urlparse as _urlparse

                given = _urlparse(endpoint)
                base = _urlparse(self._url)
                if given.scheme != base.scheme or given.netloc != base.netloc:
                    logger.warning(
                        "mcp_legacy_endpoint_rejected server={} endpoint={} "
                        "(origin mismatch — expected {}://{})",
                        self._server_name,
                        endpoint,
                        base.scheme,
                        base.netloc,
                    )
                    return
                self._legacy_endpoint = endpoint
            self._legacy_endpoint_ready.set()
            return

        if event_type == "message":
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                return
            req_id = msg.get("id")
            if req_id is not None and req_id in self._pending:
                future = self._pending.pop(req_id)
                if "error" in msg:
                    future.set_exception(RuntimeError(f"MCP error: {msg['error']}"))
                else:
                    future.set_result(msg.get("result", {}))


class _StreamableNotSupported(Exception):
    """Raised when the server does not support Streamable HTTP."""
