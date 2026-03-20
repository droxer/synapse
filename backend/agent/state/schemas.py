"""Frozen dataclass DTOs for the state layer.

These are the public API of the state module — returned by repository
methods and used at API boundaries. ORM models must never leak beyond
the repository.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class UserRecord:
    """Read-only user record."""

    id: uuid.UUID
    google_id: str
    email: str
    name: str
    picture: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ConversationRecord:
    """Read-only conversation record."""

    id: uuid.UUID
    user_id: uuid.UUID | None
    title: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class MessageRecord:
    """Read-only message record."""

    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: dict[str, Any]
    iteration: int | None
    created_at: datetime


@dataclass(frozen=True)
class EventRecord:
    """Read-only event record."""

    id: int
    conversation_id: uuid.UUID
    event_type: str
    data: dict[str, Any]
    iteration: int | None
    timestamp: datetime


@dataclass(frozen=True)
class ArtifactRecord:
    """Read-only artifact record."""

    id: str
    conversation_id: uuid.UUID
    storage_key: str
    original_name: str
    content_type: str
    size: int
    created_at: datetime


@dataclass(frozen=True)
class AgentRunRecord:
    """Read-only agent run record."""

    id: uuid.UUID
    conversation_id: uuid.UUID
    config: dict[str, Any]
    status: str
    result: dict[str, Any] | None
    created_at: datetime
