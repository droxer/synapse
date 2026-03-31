"""MCP (Model Context Protocol) server management route handlers."""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from loguru import logger
from pydantic import BaseModel

from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from agent.mcp.bridge import MCPBridgedTool, mcp_server_tag
from agent.mcp.client import MCPClient, MCPStdioClient
from agent.mcp.config import MCPServerConfig
from agent.mcp.repository import (
    delete_mcp_server as db_delete_mcp_server,
    list_mcp_servers as db_list_mcp_servers,
    save_mcp_server as db_save_mcp_server,
    set_mcp_server_enabled as db_set_mcp_server_enabled,
)
from agent.mcp.sse_client import MCPSSEClient
from agent.tools.registry import ToolRegistry
from api.auth import AuthUser, common_dependencies, get_current_user
from api.dependencies import AppState, get_app_state
from api.models import MCPServerCreateRequest, MCPServerResponse
from api.routes.conversations import _resolve_user_id
from config.settings import get_settings

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MCP_BLOCKED_ENV_VARS = {
    "PATH",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "PYTHONPATH",
    "NODE_PATH",
    "HOME",
    "USER",
}

_ALLOWED_MCP_COMMANDS = {"npx", "uvx", "node", "python", "python3"}

router = APIRouter(prefix="/mcp", dependencies=common_dependencies)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _parse_mcp_configs(raw: str) -> tuple[MCPServerConfig, ...]:
    """Parse MCP_SERVERS JSON string into validated config objects."""
    entries = json.loads(raw)
    configs: list[MCPServerConfig] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            configs.append(
                MCPServerConfig(
                    name=entry.get("name", "unknown"),
                    transport=entry.get("transport", "stdio"),
                    command=entry.get("command", ""),
                    args=tuple(entry.get("args", [])),
                    url=entry.get("url", ""),
                    env=tuple((k, v) for k, v in entry.get("env", {}).items()),
                    timeout=float(entry.get("timeout", 30.0)),
                )
            )
        except (ValueError, TypeError) as exc:
            logger.warning(
                "mcp_config_invalid name={} error={}", entry.get("name"), exc
            )
    return tuple(configs)


def _create_client_for_config(cfg: MCPServerConfig) -> MCPClient:
    """Create the appropriate MCP client for a server config."""
    if cfg.transport == "sse":
        return MCPSSEClient(
            url=cfg.url,
            server_name=cfg.name,
            timeout=cfg.timeout,
        )
    return MCPStdioClient(
        command=cfg.command,
        args=cfg.args,
        env=cfg.env,
        server_name=cfg.name,
        timeout=cfg.timeout,
    )


async def _discover_mcp_tools(
    mcp_state: Any,
    registry: ToolRegistry,
) -> tuple[ToolRegistry, dict[str, MCPClient], dict[str, MCPServerConfig]]:
    """Connect to configured MCP servers and register their tools.

    Returns the updated registry, a dict of active MCP clients keyed by
    server name, and a dict of their configs (for cleanup and introspection).
    """
    settings = get_settings()
    if not settings.MCP_SERVERS:
        return registry, {}, {}

    try:
        server_configs = _parse_mcp_configs(settings.MCP_SERVERS)
    except json.JSONDecodeError:
        logger.warning("Invalid MCP_SERVERS JSON, skipping MCP discovery")
        return registry, {}, {}

    clients: dict[str, MCPClient] = {}
    configs: dict[str, MCPServerConfig] = {}
    for cfg in server_configs:
        client = _create_client_for_config(cfg)
        try:
            await client.connect()
            tools = await client.list_tools()
            for schema in tools:
                bridged = MCPBridgedTool(schema, client, server_key=cfg.name)
                try:
                    registry = registry.register(bridged)
                    logger.info(
                        "mcp_tool_registered name={} server={}",
                        schema.name,
                        schema.server_name,
                    )
                except ValueError:
                    logger.warning(
                        "mcp_tool_skipped name={} (already registered)", schema.name
                    )
            clients[cfg.name] = client
            configs[cfg.name] = cfg
        except Exception as exc:
            logger.error("mcp_server_connect_failed name={} error={}", cfg.name, exc)
            await client.close()

    return registry, clients, configs


async def _restore_persisted_servers(
    mcp_state: Any,
    session_factory: async_sessionmaker[AsyncSession],
    user_id: Any = None,
) -> None:
    """Reconnect MCP servers that were persisted in the database for a user."""
    async with session_factory() as session:
        saved_configs = await db_list_mcp_servers(session, user_id=user_id)

    registry = mcp_state.registry or ToolRegistry()
    for cfg in saved_configs:
        if not cfg.enabled:
            # Still register config so the UI can list it, but don't connect
            key = mcp_state.user_key(user_id, cfg.name) if user_id else cfg.name
            if key not in mcp_state.configs:
                mcp_state.configs[key] = cfg
            continue
        # Namespace per-user servers with user_id prefix
        key = mcp_state.user_key(user_id, cfg.name) if user_id else cfg.name
        if key in mcp_state.configs:
            continue
        client = _create_client_for_config(cfg)
        try:
            await client.connect()
            tools = await client.list_tools()
            for schema in tools:
                bridged = MCPBridgedTool(schema, client, server_key=key)
                try:
                    registry = registry.register(bridged)
                    logger.info(
                        "mcp_tool_registered name={} server={}",
                        schema.name,
                        schema.server_name,
                    )
                except ValueError:
                    logger.warning(
                        "mcp_tool_skipped name={} (already registered)",
                        schema.name,
                    )
            mcp_state.clients[key] = client
            mcp_state.configs[key] = cfg
            logger.info("mcp_server_restored name={} user_id={}", cfg.name, user_id)
        except Exception as exc:
            logger.error("mcp_server_restore_failed name={} error={}", cfg.name, exc)
            await client.close()
    mcp_state.registry = registry


def _client_is_alive(client: MCPClient) -> bool:
    """Return True if the MCP client is still connected."""
    return client.is_alive()


def _build_server_response(mcp_state: Any, key: str) -> MCPServerResponse:
    """Build a response model for a single MCP server.

    ``key`` may be a plain name (global) or ``user_id:name`` (per-user).
    The response always uses the bare server name.
    """
    cfg = mcp_state.configs.get(key)
    client = mcp_state.clients.get(key)

    # Extract display name (strip user_id prefix if present)
    display_name = key.split(":", 1)[-1] if ":" in key else key

    server_tag = mcp_server_tag(key)
    tool_count = 0
    if mcp_state.registry is not None:
        for defn in mcp_state.registry.list_tools():
            if server_tag in (defn.tags or ()):
                tool_count += 1

    return MCPServerResponse(
        name=display_name,
        transport=cfg.transport if cfg else "stdio",
        command=cfg.command if cfg else "",
        url=cfg.url if cfg else "",
        status="connected" if client and _client_is_alive(client) else "disconnected",
        tool_count=tool_count,
        enabled=cfg.enabled if cfg else True,
    )


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@router.get("/servers")
async def list_servers(
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """GET /mcp/servers - list MCP servers visible to the current user."""
    mcp_state = state.mcp_state
    if mcp_state is None:
        raise HTTPException(status_code=503, detail="MCP is not enabled")
    user_id = await _resolve_user_id(auth_user, state)

    # Lazily restore user's persisted servers if not yet in memory
    if user_id:
        await _restore_persisted_servers(
            mcp_state, state.db_session_factory, user_id=user_id
        )

    visible = mcp_state.configs_for_user(user_id) if user_id else mcp_state.configs
    servers = [_build_server_response(mcp_state, key) for key in visible]
    return {"servers": [s.model_dump() for s in servers]}


@router.post("/servers", status_code=201)
async def add_server(
    request: MCPServerCreateRequest,
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> MCPServerResponse:
    """POST /mcp/servers - add and connect a new MCP server for the current user."""
    mcp_state = state.mcp_state
    if mcp_state is None:
        raise HTTPException(status_code=503, detail="MCP is not enabled")
    user_id = await _resolve_user_id(auth_user, state)

    # Namespace key: per-user servers use "user_id:name"
    key = mcp_state.user_key(user_id, request.name) if user_id else request.name

    if key in mcp_state.configs:
        raise HTTPException(
            status_code=409, detail=f"Server '{request.name}' already exists"
        )

    # Validate stdio-specific constraints.
    if request.transport == "stdio":
        command_basename = os.path.basename(request.command)
        if command_basename not in _ALLOWED_MCP_COMMANDS:
            raise HTTPException(
                status_code=403,
                detail=f"Command '{command_basename}' is not in the allowed MCP commands: {sorted(_ALLOWED_MCP_COMMANDS)}",
            )

    # Filter blocked environment variables
    sanitized_env = {
        k: v for k, v in request.env.items() if k not in _MCP_BLOCKED_ENV_VARS
    }

    cfg = MCPServerConfig(
        name=request.name,
        transport=request.transport,
        command=request.command,
        args=tuple(request.args),
        url=request.url,
        env=tuple(sanitized_env.items()),
        timeout=request.timeout,
    )

    client = _create_client_for_config(cfg)

    async with mcp_state.lock:
        try:
            await client.connect()
            tools = await client.list_tools()
            registry = mcp_state.registry or ToolRegistry()
            for schema in tools:
                bridged = MCPBridgedTool(schema, client, server_key=key)
                try:
                    registry = registry.register(bridged)
                except ValueError:
                    logger.warning(
                        "mcp_tool_skipped name={} (already registered)", schema.name
                    )
            mcp_state.registry = registry
            mcp_state.clients[key] = client
            mcp_state.configs[key] = cfg
        except Exception as exc:
            await client.close()
            raise HTTPException(
                status_code=502, detail=f"Failed to connect: {exc}"
            ) from exc

    # Persist to database so it survives restarts.
    try:
        async with state.db_session_factory() as session:
            await db_save_mcp_server(session, cfg, user_id=user_id)
    except Exception as exc:
        logger.warning("mcp_server_persist_failed name={} error={}", cfg.name, exc)

    return _build_server_response(mcp_state, key)


class MCPServerToggleRequest(BaseModel):
    """Body for PATCH /mcp/servers/{name}."""

    enabled: bool


@router.patch("/servers/{name}")
async def toggle_server(
    request: MCPServerToggleRequest,
    name: str = Path(...),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """PATCH /mcp/servers/{name} - toggle a server's enabled state."""
    mcp_state = state.mcp_state
    if mcp_state is None:
        raise HTTPException(status_code=503, detail="MCP is not enabled")
    user_id = await _resolve_user_id(auth_user, state)
    key = mcp_state.user_key(user_id, name) if user_id else name

    if key not in mcp_state.configs:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not found")

    # Persist to DB
    async with state.db_session_factory() as session:
        updated = await db_set_mcp_server_enabled(
            session, name, request.enabled, user_id=user_id
        )
    if updated is None:
        raise HTTPException(
            status_code=404, detail=f"Server '{name}' not found in database"
        )

    async with mcp_state.lock:
        if request.enabled:
            # Re-connect: create client, register tools
            existing_client = mcp_state.clients.pop(key, None)  # type: ignore[arg-type]
            if existing_client is not None:
                await existing_client.close()
            client = _create_client_for_config(updated)
            try:
                await client.connect()
                tools = await client.list_tools()
                registry = mcp_state.registry or ToolRegistry()
                for schema in tools:
                    bridged = MCPBridgedTool(schema, client, server_key=key)
                    try:
                        registry = registry.register(bridged)
                    except ValueError:
                        pass
                mcp_state.registry = registry
                mcp_state.clients[key] = client
                mcp_state.configs[key] = updated
            except Exception as exc:
                await client.close()
                raise HTTPException(
                    status_code=502, detail=f"Failed to reconnect: {exc}"
                ) from exc
        else:
            # Disconnect: remove tools, close client
            client = mcp_state.clients.pop(key, None)  # type: ignore[arg-type]
            if client is not None:
                await client.close()
            if mcp_state.registry is not None:
                mcp_state.registry = mcp_state.registry.remove_by_tag(
                    mcp_server_tag(key)
                )
            # Keep config in memory (with enabled=False) so UI can list it
            mcp_state.configs[key] = updated

    return {
        "name": name,
        "enabled": request.enabled,
    }


@router.delete("/servers/{name}")
async def remove_server(
    name: str = Path(...),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    """DELETE /mcp/servers/{name} - disconnect and remove a user's MCP server."""
    mcp_state = state.mcp_state
    if mcp_state is None:
        raise HTTPException(status_code=503, detail="MCP is not enabled")
    user_id = await _resolve_user_id(auth_user, state)

    key = mcp_state.user_key(user_id, name) if user_id else name

    if key not in mcp_state.configs:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not found")

    async with mcp_state.lock:
        client = mcp_state.clients.pop(key, None)  # type: ignore[arg-type]
        if client is not None:
            await client.close()

        mcp_state.configs.pop(key, None)

        if mcp_state.registry is not None:
            mcp_state.registry = mcp_state.registry.remove_by_tag(mcp_server_tag(key))

    # Remove from database.
    try:
        async with state.db_session_factory() as session:
            await db_delete_mcp_server(session, name, user_id=user_id)
    except Exception as exc:
        logger.warning("mcp_server_delete_persist_failed name={} error={}", name, exc)

    return {"detail": f"Server '{name}' removed"}
