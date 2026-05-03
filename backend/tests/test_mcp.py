"""Tests for MCP bridge, config, and client."""

from __future__ import annotations

import asyncio
import json
import types
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from api.auth import AuthUser
from api.builders import _mcp_registry_for_user
from api.models import MCPServerCreateRequest, MCPServerUpdateRequest, MCPState
from api.routes import mcp as mcp_routes
from agent.mcp import repository as mcp_repository
from agent.mcp.client import (
    MCPCallResult,
    MCPToolSchema,
    MCP_PROTOCOL_VERSION,
)
from agent.mcp.config import MCPServerConfig
from agent.mcp.sse_client import MCPSSEClient, _StreamableNotSupported
from agent.mcp.bridge import MCPBridgedTool
from agent.tools.base import ExecutionContext
from agent.tools.registry import ToolRegistry


# ---------------------------------------------------------------------------
# MCPServerConfig
# ---------------------------------------------------------------------------


class TestMCPServerConfig:
    def test_frozen(self) -> None:
        cfg = MCPServerConfig(
            name="test",
            transport="streamablehttp",
            url="https://example.com/mcp",
        )
        assert cfg.name == "test"
        assert cfg.transport == "streamablehttp"
        with pytest.raises(AttributeError):
            cfg.name = "other"  # type: ignore[misc]

    def test_defaults(self) -> None:
        cfg = MCPServerConfig(
            name="x",
            transport="streamablehttp",
            url="https://example.com/mcp",
        )
        assert cfg.url == "https://example.com/mcp"
        assert cfg.headers == ()
        assert cfg.timeout == 30.0

    def test_invalid_transport_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported MCP transport"):
            MCPServerConfig(name="x", transport="stdio")

    def test_sse_requires_url(self) -> None:
        with pytest.raises(ValueError, match="sse transport requires a url"):
            MCPServerConfig(name="x", transport="sse")

    def test_sse_valid(self) -> None:
        cfg = MCPServerConfig(name="x", transport="sse", url="http://localhost:8080")
        assert cfg.url == "http://localhost:8080"

    def test_streamablehttp_valid_with_headers(self) -> None:
        cfg = MCPServerConfig(
            name="x",
            transport="streamablehttp",
            url="https://example.com/mcp",
            headers=(("Authorization", "Bearer token"),),
        )
        assert cfg.transport == "streamablehttp"
        assert dict(cfg.headers) == {"Authorization": "Bearer token"}

    def test_streamablehttp_requires_url(self) -> None:
        with pytest.raises(ValueError, match="streamablehttp transport requires a url"):
            MCPServerConfig(name="x", transport="streamablehttp")

    def test_rejects_reserved_http_headers(self) -> None:
        with pytest.raises(ValueError, match="managed by Synapse"):
            MCPServerConfig(
                name="x",
                transport="streamablehttp",
                url="https://example.com/mcp",
                headers=(("Accept", "application/json"),),
            )

    def test_rejects_header_newlines(self) -> None:
        with pytest.raises(ValueError, match="must not contain newlines"):
            MCPServerConfig(
                name="x",
                transport="streamablehttp",
                url="https://example.com/mcp",
                headers=(("Authorization", "Bearer token\nbad"),),
            )

    def test_custom_timeout(self) -> None:
        cfg = MCPServerConfig(
            name="x",
            transport="streamablehttp",
            url="https://example.com/mcp",
            timeout=60.0,
        )
        assert cfg.timeout == 60.0


# ---------------------------------------------------------------------------
# MCPToolSchema
# ---------------------------------------------------------------------------


class TestMCPToolSchema:
    def test_frozen(self) -> None:
        schema = MCPToolSchema(
            name="test_tool",
            description="A test",
            input_schema=types.MappingProxyType({"type": "object"}),
            server_name="server1",
        )
        assert schema.name == "test_tool"

    def test_input_schema_immutable(self) -> None:
        schema = MCPToolSchema(
            name="test_tool",
            description="A test",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="server1",
        )
        with pytest.raises(TypeError):
            schema.input_schema["type"] = "string"  # type: ignore[index]


# ---------------------------------------------------------------------------
# MCPCallResult
# ---------------------------------------------------------------------------


class TestMCPCallResult:
    def test_success(self) -> None:
        r = MCPCallResult(content="ok")
        assert not r.is_error

    def test_error(self) -> None:
        r = MCPCallResult(content="fail", is_error=True)
        assert r.is_error


# ---------------------------------------------------------------------------
# MCPBridgedTool
# ---------------------------------------------------------------------------


class TestMCPBridgedTool:
    def test_definition_has_prefixed_name(self) -> None:
        schema = MCPToolSchema(
            name="mcp_test",
            description="Test MCP tool",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="test_server",
        )
        tool = MCPBridgedTool(schema, client=None)  # type: ignore[arg-type]
        defn = tool.definition()
        assert defn.name == "test_server__mcp_test"
        assert defn.execution_context == ExecutionContext.LOCAL
        assert "mcp" in defn.tags
        assert "test_server" in defn.tags

    def test_definition_namespaces_same_server_name_per_user(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="shared",
        )

        tool_a = MCPBridgedTool(
            schema,
            client=None,  # type: ignore[arg-type]
            server_key="user-a:shared",
        )
        tool_b = MCPBridgedTool(
            schema,
            client=None,  # type: ignore[arg-type]
            server_key="user-b:shared",
        )

        defn_a = tool_a.definition()
        defn_b = tool_b.definition()

        assert defn_a.name != defn_b.name
        assert "mcp_server:user-a:shared" in defn_a.tags
        assert "mcp_server:user-b:shared" in defn_b.tags
        assert "shared" in defn_a.tags
        assert "shared" in defn_b.tags

    def test_remove_by_tag_only_removes_matching_namespaced_server(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="shared",
        )
        registry = ToolRegistry()
        registry = registry.register(
            MCPBridgedTool(
                schema,
                client=None,  # type: ignore[arg-type]
                server_key="user-a:shared",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                schema,
                client=None,  # type: ignore[arg-type]
                server_key="user-b:shared",
            )
        )

        filtered = registry.remove_by_tag("mcp_server:user-a:shared")
        names = {tool.name for tool in filtered.list_tools()}

        assert len(names) == 1
        assert all("user-a" not in name for name in names)

    def test_definition_avoids_global_name_collisions_after_sanitizing(self) -> None:
        schema_a = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="foo/bar",
        )
        schema_b = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="foo bar",
        )

        defn_a = MCPBridgedTool(schema_a, client=None).definition()  # type: ignore[arg-type]
        defn_b = MCPBridgedTool(schema_b, client=None).definition()  # type: ignore[arg-type]

        assert defn_a.name != defn_b.name

    def test_builder_mcp_registry_scopes_tools_by_visible_server(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
            server_name="shared",
        )
        registry = ToolRegistry()
        registry = registry.register(
            MCPBridgedTool(
                schema,
                client=None,  # type: ignore[arg-type]
                server_key="global",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                schema,
                client=None,  # type: ignore[arg-type]
                server_key="user-a:shared",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                schema,
                client=None,  # type: ignore[arg-type]
                server_key="user-b:shared",
            )
        )
        state = MCPState(
            registry=registry,
            configs={
                "global": MCPServerConfig(
                    name="global",
                    transport="streamablehttp",
                    url="https://example.com/global",
                ),
                "user-a:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://example.com/user-a",
                ),
                "user-b:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://example.com/user-b",
                ),
            },
        )

        filtered = _mcp_registry_for_user(state, "user-a")
        assert filtered is not None
        tool_tags = {
            tag
            for definition in filtered.list_tools()
            for tag in (definition.tags or ())
        }

        assert "mcp_server:global" in tool_tags
        assert "mcp_server:user-a:shared" in tool_tags
        assert "mcp_server:user-b:shared" not in tool_tags

    @pytest.mark.asyncio
    async def test_execute_success(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object"}),
            server_name="srv",
        )
        mock_client = AsyncMock()
        mock_client.call_tool.return_value = MCPCallResult(content="found it")

        tool = MCPBridgedTool(schema, mock_client)
        result = await tool.execute(query="test")

        mock_client.call_tool.assert_awaited_once_with("search", {"query": "test"})
        assert result.success
        assert result.output == "found it"

    @pytest.mark.asyncio
    async def test_execute_error(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object"}),
            server_name="srv",
        )
        mock_client = AsyncMock()
        mock_client.call_tool.return_value = MCPCallResult(
            content="not found", is_error=True
        )

        tool = MCPBridgedTool(schema, mock_client)
        result = await tool.execute(query="test")

        assert not result.success
        assert result.error == "not found"

    def test_registry_export_normalizes_mappingproxy_input_schema(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType(
                {
                    "type": "object",
                    "properties": {"q": {"type": "string"}},
                    "required": ("q",),
                }
            ),
            server_name="srv",
        )
        registry = ToolRegistry().register(MCPBridgedTool(schema, client=None))  # type: ignore[arg-type]

        tools = registry.to_anthropic_tools()

        assert isinstance(tools[0]["input_schema"], dict)
        assert tools[0]["input_schema"]["required"] == ["q"]
        json.dumps(tools)

    def test_registry_export_reuses_cached_anthropic_payload(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema={"type": "object"},
            server_name="srv",
        )
        registry = ToolRegistry().register(MCPBridgedTool(schema, client=None))  # type: ignore[arg-type]

        first = registry.to_anthropic_tools()
        second = registry.to_anthropic_tools()

        assert first is second

    def test_registry_export_cache_breakpoint_marks_last_tool(self) -> None:
        first_schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema={"type": "object"},
            server_name="srv",
        )
        second_schema = MCPToolSchema(
            name="fetch",
            description="Fetch",
            input_schema={"type": "object"},
            server_name="srv",
        )
        registry = (
            ToolRegistry()
            .register(MCPBridgedTool(first_schema, client=None))  # type: ignore[arg-type]
            .register(MCPBridgedTool(second_schema, client=None))  # type: ignore[arg-type]
        )

        tools = registry.to_anthropic_tools(cache_breakpoint=True)

        assert "cache_control" not in tools[0]
        assert tools[-1]["cache_control"] == {"type": "ephemeral"}

    def test_registry_fingerprint_is_stable_for_same_schema(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema={"type": "object", "properties": {"q": {"type": "string"}}},
            server_name="srv",
        )
        left = ToolRegistry().register(MCPBridgedTool(schema, client=None))  # type: ignore[arg-type]
        right = ToolRegistry().register(MCPBridgedTool(schema, client=None))  # type: ignore[arg-type]

        assert left.anthropic_tools_fingerprint() == right.anthropic_tools_fingerprint()

    def test_registry_fingerprint_changes_when_schema_changes(self) -> None:
        search_schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema={"type": "object"},
            server_name="srv",
        )
        fetch_schema = MCPToolSchema(
            name="fetch",
            description="Fetch",
            input_schema={"type": "object"},
            server_name="srv",
        )
        left = ToolRegistry().register(MCPBridgedTool(search_schema, client=None))  # type: ignore[arg-type]
        right = ToolRegistry().register(MCPBridgedTool(fetch_schema, client=None))  # type: ignore[arg-type]

        assert left.anthropic_tools_fingerprint() != right.anthropic_tools_fingerprint()


class TestMCPStreamableHTTPClient:
    @pytest.mark.asyncio
    async def test_sends_headers_session_and_parses_sse_response(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.method == "DELETE":
                return httpx.Response(204)

            body = json.loads(request.content)
            method = body["method"]
            if method == "initialize":
                return httpx.Response(
                    200,
                    headers={
                        "content-type": "application/json",
                        "mcp-session-id": "session-1",
                    },
                    json={
                        "jsonrpc": "2.0",
                        "id": body["id"],
                        "result": {"protocolVersion": MCP_PROTOCOL_VERSION},
                    },
                )
            if method == "notifications/initialized":
                return httpx.Response(202)
            if method == "tools/list":
                message = json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": body["id"],
                        "result": {
                            "tools": [
                                {
                                    "name": "search",
                                    "description": "Search",
                                    "inputSchema": {
                                        "type": "object",
                                        "properties": {},
                                    },
                                }
                            ]
                        },
                    }
                )
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text=f"event: message\ndata: {message}\n\n",
                )
            return httpx.Response(500)

        client = MCPSSEClient(
            url="https://example.com/mcp",
            server_name="docs",
            headers=(("Authorization", "Bearer token"),),
            allow_legacy_fallback=False,
        )
        client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        await client._streamable_initialize()
        tools = await client.list_tools()

        initialize_request = requests[0]
        tools_request = next(
            request for request in requests if b'"tools/list"' in request.content
        )

        assert tools[0].name == "search"
        assert initialize_request.headers["authorization"] == "Bearer token"
        assert initialize_request.headers["accept"] == (
            "application/json, text/event-stream"
        )
        assert (
            initialize_request.headers["mcp-protocol-version"] == MCP_PROTOCOL_VERSION
        )
        assert tools_request.headers["mcp-session-id"] == "session-1"

        await client.close()

    @pytest.mark.asyncio
    async def test_explicit_streamablehttp_does_not_fallback_to_legacy_sse(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        client = MCPSSEClient(
            url="https://example.com/mcp",
            server_name="docs",
            allow_legacy_fallback=False,
        )
        monkeypatch.setattr(
            client,
            "_streamable_initialize",
            AsyncMock(side_effect=_StreamableNotSupported()),
        )

        with pytest.raises(RuntimeError, match="does not support Streamable HTTP"):
            await client.connect()

        assert client._legacy is False


# ---------------------------------------------------------------------------
# Protocol version constant
# ---------------------------------------------------------------------------


class TestProtocolVersion:
    def test_protocol_version_is_string(self) -> None:
        assert isinstance(MCP_PROTOCOL_VERSION, str)
        assert len(MCP_PROTOCOL_VERSION) > 0


class TestMCPServerCreateRequest:
    def test_accepts_type_alias_and_headers(self) -> None:
        request = MCPServerCreateRequest.model_validate(
            {
                "name": "mcd-mcp",
                "type": "streamablehttp",
                "url": "https://mcp.mcd.cn",
                "headers": {"Authorization": "Bearer token"},
            }
        )

        assert request.transport == "streamablehttp"
        assert request.headers == {"Authorization": "Bearer token"}

    def test_rejects_reserved_headers(self) -> None:
        with pytest.raises(ValueError, match="managed by Synapse"):
            MCPServerCreateRequest.model_validate(
                {
                    "name": "mcd-mcp",
                    "type": "streamablehttp",
                    "url": "https://mcp.mcd.cn",
                    "headers": {"Mcp-Session-Id": "abc"},
                }
            )

    def test_rejects_stdio_transport(self) -> None:
        with pytest.raises(ValueError, match="transport must be 'sse'"):
            MCPServerCreateRequest.model_validate(
                {"name": "local", "transport": "stdio", "command": "npx"}
            )


class TestMCPRepository:
    @pytest.mark.asyncio
    async def test_save_and_load_headers(self, session: Any) -> None:
        cfg = MCPServerConfig(
            name="mcd-mcp",
            transport="streamablehttp",
            url="https://mcp.mcd.cn",
            headers=(("Authorization", "Bearer token"),),
        )

        await mcp_repository.save_mcp_server(session, cfg)
        loaded = await mcp_repository.list_mcp_servers(session)

        assert len(loaded) == 1
        assert loaded[0].transport == "streamablehttp"
        assert dict(loaded[0].headers) == {"Authorization": "Bearer token"}


# ---------------------------------------------------------------------------
# Registry merge
# ---------------------------------------------------------------------------


class TestRegistryMerge:
    def test_merge_two_registries(self) -> None:
        from agent.tools.sandbox.database import DbCreate, DbQuery

        r1 = ToolRegistry().register(DbCreate())
        r2 = ToolRegistry().register(DbQuery())
        merged = r1.merge(r2)
        assert merged.get("database_create") is not None
        assert merged.get("database_query") is not None

    def test_merge_collision_raises(self) -> None:
        from agent.tools.sandbox.database import DbCreate

        r1 = ToolRegistry().register(DbCreate())
        r2 = ToolRegistry().register(DbCreate())
        with pytest.raises(ValueError):
            r1.merge(r2)


class _FakeRouteClient:
    def __init__(
        self,
        *,
        schemas: tuple[MCPToolSchema, ...] = (),
        alive: bool = True,
    ) -> None:
        self._schemas = schemas
        self._alive = alive
        self.connected = False
        self.closed = False

    async def connect(self) -> None:
        self.connected = True

    async def list_tools(self) -> tuple[MCPToolSchema, ...]:
        return self._schemas

    async def close(self) -> None:
        self.closed = True
        self._alive = False

    def is_alive(self) -> bool:
        return self._alive


class _FailingRouteClient(_FakeRouteClient):
    async def list_tools(self) -> tuple[MCPToolSchema, ...]:
        raise RuntimeError("list failed")


def _schema(name: str, server_name: str = "shared") -> MCPToolSchema:
    return MCPToolSchema(
        name=name,
        description=f"{name} tool",
        input_schema=types.MappingProxyType({"type": "object", "properties": {}}),
        server_name=server_name,
    )


def _auth_user() -> AuthUser:
    return AuthUser(
        google_id="google-user-1",
        email="user@example.com",
        name="User",
        picture=None,
    )


def _app_state(mcp_state: MCPState) -> SimpleNamespace:
    @asynccontextmanager
    async def _session_factory():
        yield object()

    return SimpleNamespace(mcp_state=mcp_state, db_session_factory=_session_factory)


class TestMCPRoutes:
    @pytest.mark.asyncio
    async def test_restore_persisted_servers_concurrent_restore_closes_losing_client(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mcp_state = MCPState(registry=ToolRegistry())
        ready_count = 0
        ready = asyncio.Event()
        release = asyncio.Event()

        class _BlockingRouteClient(_FakeRouteClient):
            async def connect(self) -> None:
                nonlocal ready_count
                ready_count += 1
                if ready_count == 2:
                    ready.set()
                await release.wait()
                await super().connect()

        clients = [
            _BlockingRouteClient(schemas=(_schema("shared_tool"),)),
            _BlockingRouteClient(schemas=(_schema("shared_tool"),)),
        ]
        all_clients = tuple(clients)

        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(
                return_value=(
                    MCPServerConfig(
                        name="shared",
                        transport="streamablehttp",
                        url="https://shared.example/mcp",
                    ),
                )
            ),
        )
        monkeypatch.setattr(
            mcp_routes,
            "_create_client_for_config",
            lambda cfg: clients.pop(0),
        )

        first_restore = asyncio.create_task(
            mcp_routes._restore_persisted_servers(
                mcp_state,
                _app_state(mcp_state).db_session_factory,
                user_id="user-1",
            )
        )
        second_restore = asyncio.create_task(
            mcp_routes._restore_persisted_servers(
                mcp_state,
                _app_state(mcp_state).db_session_factory,
                user_id="user-1",
            )
        )
        await asyncio.wait_for(ready.wait(), timeout=1)
        release.set()

        await asyncio.gather(first_restore, second_restore)

        assert "user-1:shared" in mcp_state.clients
        assert len(mcp_state.registry.list_tools()) == 1
        restored_client = mcp_state.clients["user-1:shared"]
        assert restored_client.closed is False
        assert sum(client.closed for client in all_clients) == 1

    @pytest.mark.asyncio
    async def test_list_servers_only_counts_visible_namespaced_tools(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = ToolRegistry()
        registry = registry.register(
            MCPBridgedTool(_schema("global_tool", "global"), client=None)  # type: ignore[arg-type]
        )
        registry = registry.register(
            MCPBridgedTool(
                _schema("mine"),
                client=None,  # type: ignore[arg-type]
                server_key="user-1:shared",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                _schema("peer"),
                client=None,  # type: ignore[arg-type]
                server_key="user-2:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={
                "global": _FakeRouteClient(),
                "user-1:shared": _FakeRouteClient(),
                "user-2:shared": _FakeRouteClient(),
            },
            configs={
                "global": MCPServerConfig(
                    name="global",
                    transport="streamablehttp",
                    url="https://global.example/mcp",
                ),
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
            },
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(mcp_routes, "_restore_persisted_servers", AsyncMock())

        result = await mcp_routes.list_servers(_app_state(mcp_state), _auth_user())

        assert result["servers"] == [
            {
                "name": "global",
                "transport": "streamablehttp",
                "url": "https://global.example/mcp",
                "headers": {},
                "timeout": 30.0,
                "status": "connected",
                "tool_count": 1,
                "enabled": True,
                "editable": False,
            },
            {
                "name": "shared",
                "transport": "streamablehttp",
                "url": "https://shared.example/mcp",
                "headers": {},
                "timeout": 30.0,
                "status": "connected",
                "tool_count": 1,
                "enabled": True,
                "editable": True,
            },
        ]

    @pytest.mark.asyncio
    async def test_add_server_counts_only_new_users_tools(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        registry = ToolRegistry().register(
            MCPBridgedTool(
                _schema("peer_tool"),
                client=None,  # type: ignore[arg-type]
                server_key="user-2:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={"user-2:shared": _FakeRouteClient()},
            configs={
                "user-2:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                )
            },
        )
        new_client = _FakeRouteClient(schemas=(_schema("my_tool"),))

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes, "_create_client_for_config", lambda cfg: new_client
        )
        monkeypatch.setattr(mcp_routes, "db_save_mcp_server", AsyncMock())

        response = await mcp_routes.add_server(
            MCPServerCreateRequest(
                name="shared",
                transport="streamablehttp",
                url="https://shared.example/mcp",
            ),
            _app_state(mcp_state),
            _auth_user(),
        )

        assert response.name == "shared"
        assert response.tool_count == 1
        assert len(mcp_state.registry.list_tools()) == 2

    @pytest.mark.asyncio
    async def test_toggle_server_removes_only_target_users_tools(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_client = _FakeRouteClient()
        peer_client = _FakeRouteClient()
        registry = ToolRegistry()
        registry = registry.register(
            MCPBridgedTool(
                _schema("mine"),
                client=None,  # type: ignore[arg-type]
                server_key="user-1:shared",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                _schema("peer"),
                client=None,  # type: ignore[arg-type]
                server_key="user-2:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={"user-1:shared": user_client, "user-2:shared": peer_client},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
            },
        )
        updated = MCPServerConfig(
            name="shared",
            transport="streamablehttp",
            url="https://shared.example/mcp",
            enabled=False,
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_set_mcp_server_enabled",
            AsyncMock(return_value=updated),
        )

        result = await mcp_routes.toggle_server(
            mcp_routes.MCPServerToggleRequest(enabled=False),
            "shared",
            _app_state(mcp_state),
            _auth_user(),
        )

        assert result == {"name": "shared", "enabled": False}
        assert user_client.closed is True
        assert "user-1:shared" not in mcp_state.clients
        assert "user-2:shared" in mcp_state.clients
        assert len(mcp_state.registry.list_tools()) == 1

    @pytest.mark.asyncio
    async def test_toggle_server_enable_replaces_existing_client_cleanly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        old_client = _FakeRouteClient()
        new_client = _FakeRouteClient(schemas=(_schema("mine"),))
        mcp_state = MCPState(
            registry=ToolRegistry(),
            clients={"user-1:shared": old_client},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                    enabled=False,
                )
            },
        )
        updated = MCPServerConfig(
            name="shared",
            transport="streamablehttp",
            url="https://shared.example/mcp",
            enabled=True,
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_set_mcp_server_enabled",
            AsyncMock(return_value=updated),
        )
        monkeypatch.setattr(
            mcp_routes, "_create_client_for_config", lambda cfg: new_client
        )

        result = await mcp_routes.toggle_server(
            mcp_routes.MCPServerToggleRequest(enabled=True),
            "shared",
            _app_state(mcp_state),
            _auth_user(),
        )

        assert result == {"name": "shared", "enabled": True}
        assert old_client.closed is True
        assert mcp_state.clients["user-1:shared"] is new_client
        assert len(mcp_state.registry.list_tools()) == 1

    @pytest.mark.asyncio
    async def test_toggle_server_enable_does_not_persist_when_reconnect_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mcp_state = MCPState(
            registry=ToolRegistry(),
            clients={},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                    enabled=False,
                )
            },
        )
        failing_client = _FailingRouteClient()
        set_enabled = AsyncMock()

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "_create_client_for_config",
            lambda cfg: failing_client,
        )
        monkeypatch.setattr(mcp_routes, "db_set_mcp_server_enabled", set_enabled)

        with pytest.raises(HTTPException) as exc_info:
            await mcp_routes.toggle_server(
                mcp_routes.MCPServerToggleRequest(enabled=True),
                "shared",
                _app_state(mcp_state),
                _auth_user(),
            )

        assert exc_info.value.status_code == 502
        assert failing_client.closed is True
        set_enabled.assert_not_awaited()
        assert mcp_state.clients == {}
        assert mcp_state.configs["user-1:shared"].enabled is False

    @pytest.mark.asyncio
    async def test_update_enabled_server_reconnects_and_replaces_tools(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        old_client = _FakeRouteClient()
        new_client = _FakeRouteClient(schemas=(_schema("new_tool", "renamed"),))
        registry = ToolRegistry().register(
            MCPBridgedTool(
                _schema("old_tool"),
                client=None,  # type: ignore[arg-type]
                server_key="user-1:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={"user-1:shared": old_client},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://old.example/mcp",
                )
            },
        )
        updated = MCPServerConfig(
            name="renamed",
            transport="streamablehttp",
            url="https://new.example/mcp",
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(
                return_value=(
                    MCPServerConfig(
                        name="shared",
                        transport="streamablehttp",
                        url="https://old.example/mcp",
                    ),
                )
            ),
        )
        monkeypatch.setattr(
            mcp_routes, "_create_client_for_config", lambda cfg: new_client
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_update_mcp_server",
            AsyncMock(return_value=updated),
        )

        response = await mcp_routes.update_server(
            MCPServerUpdateRequest(
                name="renamed",
                transport="streamablehttp",
                url="https://new.example/mcp",
            ),
            "shared",
            _app_state(mcp_state),
            _auth_user(),
        )

        assert response.name == "renamed"
        assert response.tool_count == 1
        assert old_client.closed is True
        assert new_client.connected is True
        assert "user-1:shared" not in mcp_state.clients
        assert mcp_state.clients["user-1:renamed"] is new_client
        assert "user-1:shared" not in mcp_state.configs
        assert mcp_state.configs["user-1:renamed"].url == "https://new.example/mcp"
        tool_names = {tool.name for tool in mcp_state.registry.list_tools()}
        assert all("old_tool" not in name for name in tool_names)

    @pytest.mark.asyncio
    async def test_update_enabled_server_closes_new_client_when_db_update_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        old_client = _FakeRouteClient()
        new_client = _FakeRouteClient(schemas=(_schema("new_tool", "renamed"),))
        registry = ToolRegistry().register(
            MCPBridgedTool(
                _schema("old_tool"),
                client=None,  # type: ignore[arg-type]
                server_key="user-1:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={"user-1:shared": old_client},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://old.example/mcp",
                )
            },
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(
                return_value=(
                    MCPServerConfig(
                        name="shared",
                        transport="streamablehttp",
                        url="https://old.example/mcp",
                    ),
                )
            ),
        )
        monkeypatch.setattr(
            mcp_routes,
            "_create_client_for_config",
            lambda cfg: new_client,
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_update_mcp_server",
            AsyncMock(side_effect=RuntimeError("database unavailable")),
        )

        with pytest.raises(RuntimeError, match="database unavailable"):
            await mcp_routes.update_server(
                MCPServerUpdateRequest(
                    name="renamed",
                    transport="streamablehttp",
                    url="https://new.example/mcp",
                ),
                "shared",
                _app_state(mcp_state),
                _auth_user(),
            )

        assert new_client.closed is True
        assert old_client.closed is False
        assert mcp_state.clients["user-1:shared"] is old_client
        assert "user-1:renamed" not in mcp_state.configs
        tool_names = {tool.name for tool in mcp_state.registry.list_tools()}
        assert len(tool_names) == 1
        assert all("old_tool" in name for name in tool_names)

    @pytest.mark.asyncio
    async def test_update_disabled_server_does_not_connect(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mcp_state = MCPState(
            registry=ToolRegistry(),
            clients={},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://old.example/mcp",
                    enabled=False,
                )
            },
        )
        updated = MCPServerConfig(
            name="shared",
            transport="sse",
            url="https://new.example/sse",
            enabled=False,
        )
        create_client = AsyncMock()

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(
                return_value=(
                    MCPServerConfig(
                        name="shared",
                        transport="streamablehttp",
                        url="https://old.example/mcp",
                        enabled=False,
                    ),
                )
            ),
        )
        monkeypatch.setattr(mcp_routes, "_create_client_for_config", create_client)
        monkeypatch.setattr(
            mcp_routes,
            "db_update_mcp_server",
            AsyncMock(return_value=updated),
        )

        response = await mcp_routes.update_server(
            MCPServerUpdateRequest(
                name="shared",
                transport="sse",
                url="https://new.example/sse",
            ),
            "shared",
            _app_state(mcp_state),
            _auth_user(),
        )

        assert response.name == "shared"
        assert response.enabled is False
        assert response.status == "disconnected"
        assert mcp_state.clients == {}
        assert mcp_state.configs["user-1:shared"].transport == "sse"
        create_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_update_rename_leaves_same_name_peer_server_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_client = _FakeRouteClient()
        peer_client = _FakeRouteClient()
        new_client = _FakeRouteClient(schemas=(_schema("mine_new", "mine-renamed"),))
        registry = ToolRegistry()
        registry = registry.register(
            MCPBridgedTool(
                _schema("mine"),
                client=None,  # type: ignore[arg-type]
                server_key="user-1:shared",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                _schema("peer"),
                client=None,  # type: ignore[arg-type]
                server_key="user-2:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={"user-1:shared": user_client, "user-2:shared": peer_client},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://peer.example/mcp",
                ),
            },
        )
        updated = MCPServerConfig(
            name="mine-renamed",
            transport="streamablehttp",
            url="https://renamed.example/mcp",
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(
                return_value=(
                    MCPServerConfig(
                        name="shared",
                        transport="streamablehttp",
                        url="https://shared.example/mcp",
                    ),
                )
            ),
        )
        monkeypatch.setattr(
            mcp_routes, "_create_client_for_config", lambda cfg: new_client
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_update_mcp_server",
            AsyncMock(return_value=updated),
        )

        response = await mcp_routes.update_server(
            MCPServerUpdateRequest(
                name="mine-renamed",
                transport="streamablehttp",
                url="https://renamed.example/mcp",
            ),
            "shared",
            _app_state(mcp_state),
            _auth_user(),
        )

        assert response.name == "mine-renamed"
        assert user_client.closed is True
        assert mcp_state.clients["user-2:shared"] is peer_client
        assert "user-2:shared" in mcp_state.configs
        assert "user-1:mine-renamed" in mcp_state.configs
        assert len(mcp_state.registry.list_tools()) == 2

    @pytest.mark.asyncio
    async def test_update_rename_conflict_returns_409(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mcp_state = MCPState(
            registry=ToolRegistry(),
            clients={"user-1:shared": _FakeRouteClient()},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                )
            },
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(
                return_value=(
                    MCPServerConfig(
                        name="shared",
                        transport="streamablehttp",
                        url="https://shared.example/mcp",
                    ),
                    MCPServerConfig(
                        name="taken",
                        transport="streamablehttp",
                        url="https://taken.example/mcp",
                    ),
                )
            ),
        )

        with pytest.raises(HTTPException) as exc_info:
            await mcp_routes.update_server(
                MCPServerUpdateRequest(
                    name="taken",
                    transport="streamablehttp",
                    url="https://new.example/mcp",
                ),
                "shared",
                _app_state(mcp_state),
                _auth_user(),
            )

        assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_update_global_non_persisted_server_returns_404(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mcp_state = MCPState(
            registry=ToolRegistry(),
            clients={"global": _FakeRouteClient()},
            configs={
                "global": MCPServerConfig(
                    name="global",
                    transport="streamablehttp",
                    url="https://global.example/mcp",
                )
            },
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes,
            "db_list_mcp_servers",
            AsyncMock(return_value=()),
        )

        with pytest.raises(HTTPException) as exc_info:
            await mcp_routes.update_server(
                MCPServerUpdateRequest(
                    name="global",
                    transport="streamablehttp",
                    url="https://new.example/mcp",
                ),
                "global",
                _app_state(mcp_state),
                _auth_user(),
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_server_leaves_same_name_peer_server_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_client = _FakeRouteClient()
        peer_client = _FakeRouteClient()
        registry = ToolRegistry()
        registry = registry.register(
            MCPBridgedTool(
                _schema("mine"),
                client=None,  # type: ignore[arg-type]
                server_key="user-1:shared",
            )
        )
        registry = registry.register(
            MCPBridgedTool(
                _schema("peer"),
                client=None,  # type: ignore[arg-type]
                server_key="user-2:shared",
            )
        )
        mcp_state = MCPState(
            registry=registry,
            clients={"user-1:shared": user_client, "user-2:shared": peer_client},
            configs={
                "user-1:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared",
                    transport="streamablehttp",
                    url="https://shared.example/mcp",
                ),
            },
        )

        monkeypatch.setattr(
            mcp_routes,
            "_resolve_user_id",
            AsyncMock(return_value="user-1"),
        )
        monkeypatch.setattr(
            mcp_routes, "db_delete_mcp_server", AsyncMock(return_value=True)
        )

        result = await mcp_routes.remove_server(
            "shared",
            _app_state(mcp_state),
            _auth_user(),
        )

        assert result == {"detail": "Server 'shared' removed"}
        assert user_client.closed is True
        assert "user-1:shared" not in mcp_state.configs
        assert "user-2:shared" in mcp_state.configs
        assert len(mcp_state.registry.list_tools()) == 1
