"""SQLAlchemy models for persistent agent memory."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from agent.state.models import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MemoryEntry(Base):
    """A persistent memory entry stored per-conversation or globally."""

    __tablename__ = "memory_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    namespace = Column(String(255), nullable=False, default="default")
    key = Column(String(500), nullable=False)
    value = Column(Text, nullable=False)
    conversation_id = Column(UUID(as_uuid=True), nullable=True)  # None = global memory
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
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
    )

    __table_args__ = (
        Index("ix_memory_ns_key", "namespace", "key"),
        Index("ix_memory_conversation", "conversation_id"),
        Index("ix_memory_user", "user_id"),
    )
