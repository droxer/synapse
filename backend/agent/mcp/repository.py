"""Data access for persisted MCP server configurations."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.mcp.config import MCPServerConfig
from agent.mcp.models import MCPServerModel

_SUPPORTED_TRANSPORTS = ("sse", "streamablehttp")


class MCPServerNameConflictError(Exception):
    """Raised when an MCP server rename collides with another saved server."""


async def list_mcp_servers(
    session: AsyncSession,
    user_id: uuid.UUID | None = None,
) -> tuple[MCPServerConfig, ...]:
    """Load persisted MCP server configs for a user."""
    stmt = select(MCPServerModel).where(
        MCPServerModel.transport.in_(_SUPPORTED_TRANSPORTS)
    )
    if user_id is not None:
        stmt = stmt.where(MCPServerModel.user_id == user_id)
    stmt = stmt.order_by(MCPServerModel.created_at)
    result = await session.execute(stmt)
    rows = result.scalars().all()
    return tuple(_to_config(row) for row in rows)


async def save_mcp_server(
    session: AsyncSession,
    config: MCPServerConfig,
    user_id: uuid.UUID | None = None,
) -> None:
    """Persist an MCP server config (insert or update by user+name)."""
    stmt = select(MCPServerModel).where(MCPServerModel.name == config.name)
    if user_id is not None:
        stmt = stmt.where(MCPServerModel.user_id == user_id)
    else:
        stmt = stmt.where(MCPServerModel.user_id.is_(None))
    result = await session.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing is not None:
        existing.transport = config.transport
        existing.command = ""
        existing.args = "[]"
        existing.url = config.url
        existing.env = "{}"
        existing.headers = json.dumps(dict(config.headers))
        existing.timeout = config.timeout
        existing.enabled = config.enabled
    else:
        session.add(
            MCPServerModel(
                name=config.name,
                transport=config.transport,
                command="",
                args="[]",
                url=config.url,
                env="{}",
                headers=json.dumps(dict(config.headers)),
                timeout=config.timeout,
                enabled=config.enabled,
                user_id=user_id,
            )
        )
    await session.commit()


async def update_mcp_server(
    session: AsyncSession,
    old_name: str,
    config: MCPServerConfig,
    user_id: uuid.UUID | None = None,
) -> MCPServerConfig | None:
    """Update a persisted MCP server config by user+old name.

    Returns the updated config, None when the original row does not exist, and
    raises MCPServerNameConflictError when the requested new name is already
    used by a different server for the same user scope.
    """
    stmt = select(MCPServerModel).where(
        MCPServerModel.name == old_name,
        MCPServerModel.transport.in_(_SUPPORTED_TRANSPORTS),
    )
    if user_id is not None:
        stmt = stmt.where(MCPServerModel.user_id == user_id)
    else:
        stmt = stmt.where(MCPServerModel.user_id.is_(None))
    result = await session.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing is None:
        return None

    if config.name != old_name:
        conflict_stmt = select(MCPServerModel).where(
            MCPServerModel.name == config.name,
            MCPServerModel.transport.in_(_SUPPORTED_TRANSPORTS),
            MCPServerModel.id != existing.id,
        )
        if user_id is not None:
            conflict_stmt = conflict_stmt.where(MCPServerModel.user_id == user_id)
        else:
            conflict_stmt = conflict_stmt.where(MCPServerModel.user_id.is_(None))
        conflict_result = await session.execute(conflict_stmt)
        if conflict_result.scalar_one_or_none() is not None:
            raise MCPServerNameConflictError(f"Server '{config.name}' already exists")

    existing.name = config.name
    existing.transport = config.transport
    existing.command = ""
    existing.args = "[]"
    existing.url = config.url
    existing.env = "{}"
    existing.headers = json.dumps(dict(config.headers))
    existing.timeout = config.timeout
    existing.enabled = config.enabled
    await session.commit()
    return _to_config(existing)


async def delete_mcp_server(
    session: AsyncSession,
    name: str,
    user_id: uuid.UUID | None = None,
) -> bool:
    """Delete a persisted MCP server config by user+name. Returns True if deleted."""
    stmt = delete(MCPServerModel).where(MCPServerModel.name == name)
    if user_id is not None:
        stmt = stmt.where(MCPServerModel.user_id == user_id)
    else:
        stmt = stmt.where(MCPServerModel.user_id.is_(None))
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount > 0


async def set_mcp_server_enabled(
    session: AsyncSession,
    name: str,
    enabled: bool,
    user_id: uuid.UUID | None = None,
) -> MCPServerConfig | None:
    """Toggle the enabled state of a persisted MCP server. Returns updated config or None."""
    stmt = select(MCPServerModel).where(
        MCPServerModel.name == name,
        MCPServerModel.transport.in_(_SUPPORTED_TRANSPORTS),
    )
    if user_id is not None:
        stmt = stmt.where(MCPServerModel.user_id == user_id)
    else:
        stmt = stmt.where(MCPServerModel.user_id.is_(None))
    result = await session.execute(stmt)
    model = result.scalar_one_or_none()
    if model is None:
        return None
    model.enabled = enabled
    await session.commit()
    return _to_config(model)


def _to_config(model: MCPServerModel) -> MCPServerConfig:
    """Convert an ORM model to a frozen MCPServerConfig."""
    headers_dict = json.loads(model.headers) if model.headers else {}
    return MCPServerConfig(
        name=model.name,
        transport=model.transport,
        url=model.url or "",
        headers=tuple(headers_dict.items()),
        timeout=model.timeout or 30.0,
        enabled=model.enabled if model.enabled is not None else True,
    )
