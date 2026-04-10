"""Tests for MCP bridge, config, and client."""

from __future__ import annotations

import asyncio
import json
import types
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.auth import AuthUser
from api.models import MCPServerCreateRequest, MCPState
from api.routes import mcp as mcp_routes
from agent.mcp.client import (
    MCPCallResult,
    MCPStdioClient,
    MCPToolSchema,
    MCP_PROTOCOL_VERSION,
)
from agent.mcp.config import MCPServerConfig
from agent.mcp.bridge import MCPBridgedTool
from agent.tools.base import ExecutionContext
from agent.tools.registry import ToolRegistry


# ---------------------------------------------------------------------------
# MCPServerConfig
# ---------------------------------------------------------------------------


class TestMCPServerConfig:
    def test_frozen(self) -> None:
        cfg = MCPServerConfig(name="test", transport="stdio", command="echo")
        assert cfg.name == "test"
        assert cfg.transport == "stdio"
        with pytest.raises(AttributeError):
            cfg.name = "other"  # type: ignore[misc]

    def test_defaults(self) -> None:
        cfg = MCPServerConfig(name="x", transport="stdio", command="echo")
        assert cfg.args == ()
        assert cfg.url == ""
        assert cfg.env == ()
        assert cfg.timeout == 30.0

    def test_invalid_transport_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported MCP transport"):
            MCPServerConfig(name="x", transport="websocket", command="echo")

    def test_stdio_requires_command(self) -> None:
        with pytest.raises(ValueError, match="stdio transport requires a command"):
            MCPServerConfig(name="x", transport="stdio")

    def test_sse_requires_url(self) -> None:
        with pytest.raises(ValueError, match="sse transport requires a url"):
            MCPServerConfig(name="x", transport="sse")

    def test_sse_valid(self) -> None:
        cfg = MCPServerConfig(name="x", transport="sse", url="http://localhost:8080")
        assert cfg.url == "http://localhost:8080"

    def test_custom_timeout(self) -> None:
        cfg = MCPServerConfig(name="x", transport="stdio", command="echo", timeout=60.0)
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

    @pytest.mark.asyncio
    async def test_execute_success(self) -> None:
        schema = MCPToolSchema(
            name="search",
            description="Search",
            input_schema=types.MappingProxyType({"type": "object"}),
            server_name="srv",
        )
        mock_client = AsyncMock(spec=MCPStdioClient)
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
        mock_client = AsyncMock(spec=MCPStdioClient)
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


# ---------------------------------------------------------------------------
# MCPStdioClient
# ---------------------------------------------------------------------------


def _make_mock_process(
    responses: list[bytes],
) -> MagicMock:
    """Create a mock subprocess with stdout yielding *responses* then EOF."""
    stdout_iter = iter(responses)

    async def fake_readline() -> bytes:
        try:
            return next(stdout_iter)
        except StopIteration:
            return b""

    mock_process = MagicMock()
    mock_process.stdin = MagicMock()
    mock_process.stdin.write = MagicMock()
    mock_process.stdin.drain = AsyncMock()
    mock_process.stdout = MagicMock()
    mock_process.stdout.readline = fake_readline
    mock_process.stderr = MagicMock()
    mock_process.stderr.readline = AsyncMock(return_value=b"")
    mock_process.returncode = None
    mock_process.terminate = MagicMock()
    mock_process.kill = MagicMock()
    mock_process.wait = AsyncMock()
    return mock_process


class TestMCPStdioClientCallTool:
    """Test call_tool and related methods using mocked subprocess."""

    @pytest.mark.asyncio
    async def test_call_tool_success(self) -> None:
        client = MCPStdioClient(command="echo", server_name="test")

        response_line = (
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "content": [{"type": "text", "text": "hello world"}],
                        "isError": False,
                    },
                }
            )
            + "\n"
        ).encode()

        client._process = _make_mock_process([response_line])
        client._reader_task = asyncio.create_task(client._read_responses())
        client._stderr_task = asyncio.create_task(client._drain_stderr())

        result = await client.call_tool("my_tool", {"arg": "val"})

        assert not result.is_error
        assert result.content == "hello world"

        await client.close()

    @pytest.mark.asyncio
    async def test_call_tool_mcp_error(self) -> None:
        client = MCPStdioClient(command="echo", server_name="test")

        response_line = (
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "content": [{"type": "text", "text": "something went wrong"}],
                        "isError": True,
                    },
                }
            )
            + "\n"
        ).encode()

        client._process = _make_mock_process([response_line])
        client._reader_task = asyncio.create_task(client._read_responses())
        client._stderr_task = asyncio.create_task(client._drain_stderr())

        result = await client.call_tool("my_tool", {})

        assert result.is_error
        assert "something went wrong" in result.content

        await client.close()

    @pytest.mark.asyncio
    async def test_call_tool_timeout(self) -> None:
        client = MCPStdioClient(command="echo", server_name="test", timeout=0.1)

        # No responses at all — reader returns EOF immediately, future gets rejected
        client._process = _make_mock_process([])
        client._reader_task = asyncio.create_task(client._read_responses())
        client._stderr_task = asyncio.create_task(client._drain_stderr())

        # call_tool catches exceptions and returns MCPCallResult with is_error
        result = await client.call_tool("my_tool", {})
        assert result.is_error
        assert "failed" in result.content.lower()

        await client.close()


class TestMCPStdioClientReaderCrash:
    """Test that pending futures are rejected when the reader stops."""

    @pytest.mark.asyncio
    async def test_pending_futures_rejected_on_reader_exit(self) -> None:
        client = MCPStdioClient(command="echo", server_name="test", timeout=5.0)

        # Reader that immediately returns EOF (simulating process crash)
        async def eof_readline() -> bytes:
            return b""

        mock_process = MagicMock()
        mock_process.stdin = MagicMock()
        mock_process.stdin.write = MagicMock()
        mock_process.stdin.drain = AsyncMock()
        mock_process.stdout = MagicMock()
        mock_process.stdout.readline = eof_readline
        mock_process.stderr = MagicMock()
        mock_process.stderr.readline = AsyncMock(return_value=b"")
        mock_process.returncode = None
        mock_process.terminate = MagicMock()
        mock_process.kill = MagicMock()
        mock_process.wait = AsyncMock()

        client._process = mock_process

        # Manually add a pending future
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        client._pending[99] = future

        # Start reader — it will exit immediately and reject pending
        reader_task = asyncio.create_task(client._read_responses())
        await reader_task

        assert future.done()
        with pytest.raises(RuntimeError, match="reader stopped"):
            future.result()

        await client.close()


# ---------------------------------------------------------------------------
# Protocol version constant
# ---------------------------------------------------------------------------


class TestProtocolVersion:
    def test_protocol_version_is_string(self) -> None:
        assert isinstance(MCP_PROTOCOL_VERSION, str)
        assert len(MCP_PROTOCOL_VERSION) > 0


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
                    name="global", transport="stdio", command="npx"
                ),
                "user-1:shared": MCPServerConfig(
                    name="shared", transport="stdio", command="npx"
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared", transport="stdio", command="npx"
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
                "transport": "stdio",
                "command": "npx",
                "url": "",
                "status": "connected",
                "tool_count": 1,
                "enabled": True,
            },
            {
                "name": "shared",
                "transport": "stdio",
                "command": "npx",
                "url": "",
                "status": "connected",
                "tool_count": 1,
                "enabled": True,
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
                    name="shared", transport="stdio", command="npx"
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
            MCPServerCreateRequest(name="shared", transport="stdio", command="npx"),
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
                    name="shared", transport="stdio", command="npx"
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared", transport="stdio", command="npx"
                ),
            },
        )
        updated = MCPServerConfig(
            name="shared", transport="stdio", command="npx", enabled=False
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
                    name="shared", transport="stdio", command="npx", enabled=False
                )
            },
        )
        updated = MCPServerConfig(
            name="shared", transport="stdio", command="npx", enabled=True
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
                    name="shared", transport="stdio", command="npx"
                ),
                "user-2:shared": MCPServerConfig(
                    name="shared", transport="stdio", command="npx"
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
