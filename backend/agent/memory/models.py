"""SQLAlchemy models for persistent agent memory."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, String, Text
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


class MemoryFactEntry(Base):
    """Persistent high-confidence facts extracted from user conversations."""

    __tablename__ = "memory_facts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    namespace = Column(String(32), nullable=False)
    key = Column(String(255), nullable=False)
    value = Column(Text, nullable=False)
    confidence = Column(Float, nullable=False)
    status = Column(String(16), nullable=False, default="active")
    source = Column(String(32), nullable=False, default="telegram")
    source_chat_id = Column(String(128), nullable=True)
    evidence_snippet = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
    )
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)

    __table_args__ = (
        Index("ix_memory_facts_user", "user_id"),
        Index("ix_memory_facts_namespace", "namespace"),
        Index("ix_memory_facts_updated", "updated_at"),
        Index("ix_memory_facts_last_seen", "last_seen_at"),
        Index("ix_memory_facts_lookup", "user_id", "namespace", "key", "status"),
    )


class MemoryFactIngestion(Base):
    """Idempotency ledger for fact extraction per conversation turn."""

    __tablename__ = "memory_fact_ingestions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), nullable=False)
    turn_id = Column(String(100), nullable=False)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)

    __table_args__ = (
        Index(
            "ix_memory_fact_ingestions_turn",
            "conversation_id",
            "turn_id",
            unique=True,
        ),
    )
