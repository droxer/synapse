"""SQLAlchemy model for persisted MCP server configurations."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from agent.state.models import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MCPServerModel(Base):
    """A persisted MCP server configuration."""

    __tablename__ = "mcp_servers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    transport = Column(String(32), nullable=False)
    command = Column(String(500), nullable=False, default="")
    args = Column(Text, nullable=False, default="[]")  # JSON array
    url = Column(String(1000), nullable=False, default="")
    env = Column(Text, nullable=False, default="{}")  # JSON object
    headers = Column(Text, nullable=False, default="{}")  # JSON object
    timeout = Column(Float, nullable=False, default=30.0)
    enabled = Column(Boolean, nullable=False, default=True)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )

    __table_args__ = (
        Index("ix_mcp_servers_name", "name"),
        Index("ix_mcp_servers_user", "user_id"),
        UniqueConstraint("user_id", "name", name="uq_mcp_servers_user_name"),
    )
