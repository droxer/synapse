# PostgreSQL Storage Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-memory + SQLite storage with PostgreSQL as the single source of truth for conversations, messages, events, and agent runs.

**Architecture:** SQLAlchemy async ORM with asyncpg driver. Repository pattern returning frozen dataclass DTOs. Event subscriber persists data without coupling the orchestrator to the database. Alembic for migrations. Frontend fetches paginated conversation history from new API endpoints.

**Tech Stack:** SQLAlchemy[asyncio], asyncpg, Alembic, FastAPI, Next.js/Zustand

**Spec:** `docs/superpowers/specs/2026-03-16-postgresql-storage-design.md`

---

## File Map

### Backend — Create

| File | Responsibility |
|------|---------------|
| `backend/agent/state/database.py` | Async engine, session factory, `init_db()`, `get_session()` dependency |
| `backend/agent/state/schemas.py` | Frozen dataclass DTOs (`ConversationRecord`, `MessageRecord`, `EventRecord`, `AgentRunRecord`) |
| `backend/alembic.ini` | Alembic config, reads DATABASE_URL at runtime |
| `backend/migrations/env.py` | Async-aware Alembic env |
| `backend/migrations/script.py.mako` | Migration template |
| `backend/migrations/versions/001_initial_schema.py` | Initial migration: 4 tables + indexes + trigger |
| `backend/tests/test_repository.py` | Repository integration tests |
| `backend/tests/test_db_subscriber.py` | DB subscriber unit tests |

### Backend — Rewrite

| File | Change |
|------|--------|
| `backend/agent/state/models.py` | Replace SQLite dataclasses with SQLAlchemy ORM models |
| `backend/agent/state/repository.py` | Replace SQLite repository with PostgreSQL async repository |
| `backend/api/main.py` | Add DB subscriber, new endpoints, inject session dependency |
| `backend/config/settings.py` | Add `DATABASE_URL` setting |
| `backend/pyproject.toml` | Add sqlalchemy, asyncpg, alembic dependencies |

### Frontend — Create

| File | Responsibility |
|------|---------------|
| `web/src/features/conversation/api/history-api.ts` | `fetchConversations()`, `fetchMessages()` API calls |

### Frontend — Modify

| File | Change |
|------|--------|
| `web/src/shared/stores/app-store.ts` | Replace client-side history with server-fetched state, add pagination |
| `web/src/features/conversation/components/ConversationSidebar.tsx` | Use useAppStore directly for history, load on mount, infinite scroll |
| `web/src/features/conversation/components/ConversationProvider.tsx` | Remove `conversationHistory` / `sidebarCollapsed` from context (now in store) |
| `web/src/shared/components/Sidebar.tsx` | Add `onLoadMore` prop, scroll-to-bottom detection |

---

## Chunk 1: Backend Foundation (database, models, schemas, settings)

### Task 1: Add dependencies to pyproject.toml

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add sqlalchemy, asyncpg, alembic to dependencies**

In `backend/pyproject.toml`, add to the `dependencies` list:

```toml
"sqlalchemy[asyncio]>=2.0",
"asyncpg>=0.29",
"alembic>=1.13",
```

Also add pytest-asyncio mode config:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv sync`
Expected: Successful install, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "chore: add sqlalchemy, asyncpg, alembic dependencies"
```

---

### Task 2: Add DATABASE_URL to settings

**Files:**
- Modify: `backend/config/settings.py`
- Modify: `backend/.env`

- [ ] **Step 1: Add DATABASE_URL field to Settings class**

In `backend/config/settings.py`, add after the `REDIS_URL` field:

```python
DATABASE_URL: str = "postgresql+asyncpg://ha:ha@localhost:5432/synapse"
```

- [ ] **Step 2: Add DATABASE_URL to .env and .env.example**

Add to `backend/.env` (local only, not committed):

```
DATABASE_URL=postgresql+asyncpg://ha:ha@localhost:5432/synapse
```

Add to `backend/.env.example` (committed):

```
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/synapse
```

- [ ] **Step 3: Commit**

```bash
git add backend/config/settings.py backend/.env.example
git commit -m "feat: add DATABASE_URL setting for PostgreSQL"
```

---

### Task 3: Create frozen dataclass DTOs (schemas.py)

**Files:**
- Create: `backend/agent/state/schemas.py`
- Test: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_schemas.py`:

```python
"""Tests for state DTO schemas."""

import uuid
from datetime import datetime, timezone

import pytest

from agent.state.schemas import (
    AgentRunRecord,
    ConversationRecord,
    EventRecord,
    MessageRecord,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TestConversationRecord:
    def test_frozen(self) -> None:
        record = ConversationRecord(
            id=uuid.uuid4(),
            title="Test",
            status="running",
            created_at=_now(),
            updated_at=_now(),
        )
        with pytest.raises(AttributeError):
            record.title = "Changed"  # type: ignore[misc]

    def test_fields(self) -> None:
        now = _now()
        rid = uuid.uuid4()
        record = ConversationRecord(
            id=rid, title=None, status="completed", created_at=now, updated_at=now
        )
        assert record.id == rid
        assert record.title is None
        assert record.status == "completed"


class TestMessageRecord:
    def test_frozen(self) -> None:
        record = MessageRecord(
            id=uuid.uuid4(),
            conversation_id=uuid.uuid4(),
            role="user",
            content={"text": "hello"},
            iteration=None,
            created_at=_now(),
        )
        with pytest.raises(AttributeError):
            record.role = "assistant"  # type: ignore[misc]


class TestEventRecord:
    def test_frozen(self) -> None:
        record = EventRecord(
            id=1,
            conversation_id=uuid.uuid4(),
            event_type="task_start",
            data={"key": "value"},
            iteration=1,
            timestamp=_now(),
        )
        with pytest.raises(AttributeError):
            record.event_type = "changed"  # type: ignore[misc]


class TestAgentRunRecord:
    def test_frozen(self) -> None:
        record = AgentRunRecord(
            id=uuid.uuid4(),
            conversation_id=uuid.uuid4(),
            config={"model": "claude"},
            status="running",
            result=None,
            created_at=_now(),
        )
        with pytest.raises(AttributeError):
            record.status = "completed"  # type: ignore[misc]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_schemas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.state.schemas'`

- [ ] **Step 3: Write the implementation**

Create `backend/agent/state/schemas.py`:

```python
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
class ConversationRecord:
    """Read-only conversation record."""

    id: uuid.UUID
    title: str | None
    status: str
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
class AgentRunRecord:
    """Read-only agent run record."""

    id: uuid.UUID
    conversation_id: uuid.UUID
    config: dict[str, Any]
    status: str
    result: dict[str, Any] | None
    created_at: datetime
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_schemas.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/state/schemas.py backend/tests/test_schemas.py
git commit -m "feat: add frozen dataclass DTOs for state layer"
```

---

### Task 4: Create SQLAlchemy ORM models (models.py)

**Files:**
- Rewrite: `backend/agent/state/models.py`

- [ ] **Step 1: Rewrite models.py with SQLAlchemy ORM models**

Replace the entire contents of `backend/agent/state/models.py`:

```python
"""SQLAlchemy ORM models for PostgreSQL persistence.

These models are strictly internal to the repository layer.
All public APIs return frozen DTOs from ``schemas.py``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""

    pass


class ConversationModel(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="ck_conversations_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    messages: Mapped[list[MessageModel]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    events: Mapped[list[EventModel]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    agent_runs: Mapped[list[AgentRunModel]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class MessageModel(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant', 'tool')",
            name="ck_messages_role",
        ),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    iteration: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    conversation: Mapped[ConversationModel] = relationship(back_populates="messages")


class EventModel(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_conversation_timestamp", "conversation_id", "timestamp"),
        Index("ix_events_conversation_type", "conversation_id", "event_type"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    iteration: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    conversation: Mapped[ConversationModel] = relationship(back_populates="events")


class AgentRunModel(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        Index("ix_agent_runs_conversation", "conversation_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    conversation: Mapped[ConversationModel] = relationship(back_populates="agent_runs")
```

- [ ] **Step 2: Verify models import correctly**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run python -c "from agent.state.models import Base, ConversationModel, MessageModel, EventModel, AgentRunModel; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/agent/state/models.py
git commit -m "feat: replace SQLite dataclasses with SQLAlchemy ORM models"
```

---

### Task 5: Create database.py (engine, session factory, init_db)

**Files:**
- Create: `backend/agent/state/database.py`
- Test: `backend/tests/test_database.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_database.py`:

```python
"""Tests for database module."""

import pytest

from agent.state.database import get_engine, get_session_factory


def test_get_engine_returns_async_engine() -> None:
    from sqlalchemy.ext.asyncio import AsyncEngine

    engine = get_engine("postgresql+asyncpg://ha:ha@localhost:5432/synapse")
    assert isinstance(engine, AsyncEngine)


def test_get_session_factory_returns_callable() -> None:
    engine = get_engine("postgresql+asyncpg://ha:ha@localhost:5432/synapse")
    factory = get_session_factory(engine)
    assert callable(factory)


def test_get_engine_invalid_url_raises() -> None:
    with pytest.raises(Exception):
        get_engine("")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_database.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

Create `backend/agent/state/database.py`:

```python
"""Async database engine and session management.

Provides factory functions for creating the async engine and session
maker. The ``get_session`` async generator is designed for use as a
FastAPI dependency.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from loguru import logger
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def get_engine(database_url: str) -> AsyncEngine:
    """Create an async SQLAlchemy engine.

    Args:
        database_url: PostgreSQL connection URL with asyncpg driver.

    Returns:
        Configured AsyncEngine with connection pooling.
    """
    if not database_url:
        raise ValueError("database_url must not be empty")

    return create_async_engine(
        database_url,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        echo=False,
    )


def get_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Create a session factory bound to the given engine.

    Args:
        engine: The async engine to bind sessions to.

    Returns:
        An async_sessionmaker that produces AsyncSession instances.
    """
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_db(engine: AsyncEngine) -> None:
    """Verify database connectivity at startup.

    Does NOT create tables — Alembic handles schema management.

    Args:
        engine: The async engine to test.

    Raises:
        Exception: If the database is unreachable.
    """
    async with engine.connect() as conn:
        await conn.execute(
            __import__("sqlalchemy").text("SELECT 1")
        )
    logger.info("database_connection_verified")


async def get_session(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession, None]:
    """Yield an async session, closing it when done.

    Designed for use as a FastAPI dependency via functools.partial.

    Args:
        factory: The session factory to use.

    Yields:
        An AsyncSession instance.
    """
    async with factory() as session:
        yield session
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_database.py -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/state/database.py backend/tests/test_database.py
git commit -m "feat: add async database engine and session management"
```

---

## Chunk 2: Repository & Alembic

### Task 6: Rewrite repository.py for PostgreSQL

**Files:**
- Rewrite: `backend/agent/state/repository.py`
- Test: `backend/tests/test_repository.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_repository.py`:

```python
"""Integration tests for ConversationRepository.

Requires a running PostgreSQL instance at DATABASE_URL.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from agent.state.models import Base
from agent.state.repository import ConversationRepository

TEST_DB_URL = "postgresql+asyncpg://ha:ha@localhost:5432/synapse_test"


@pytest_asyncio.fixture
async def session():
    """Create a fresh test database session with tables, rolled back after each test."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as sess:
        yield sess
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
def repo() -> ConversationRepository:
    return ConversationRepository()


class TestCreateConversation:
    @pytest.mark.asyncio
    async def test_creates_with_title(self, repo, session: AsyncSession) -> None:
        record = await repo.create_conversation(session, title="Test convo")
        assert record.title == "Test convo"
        assert record.status == "running"
        assert record.id is not None

    @pytest.mark.asyncio
    async def test_creates_without_title(self, repo, session: AsyncSession) -> None:
        record = await repo.create_conversation(session, title=None)
        assert record.title is None


class TestGetConversation:
    @pytest.mark.asyncio
    async def test_returns_none_for_missing(self, repo, session: AsyncSession) -> None:
        result = await repo.get_conversation(session, uuid.uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_existing(self, repo, session: AsyncSession) -> None:
        created = await repo.create_conversation(session, title="Find me")
        found = await repo.get_conversation(session, created.id)
        assert found is not None
        assert found.id == created.id
        assert found.title == "Find me"


class TestListConversations:
    @pytest.mark.asyncio
    async def test_paginated_list(self, repo, session: AsyncSession) -> None:
        for i in range(5):
            await repo.create_conversation(session, title=f"Convo {i}")
        items, total = await repo.list_conversations(session, limit=2, offset=0)
        assert len(items) == 2
        assert total == 5

    @pytest.mark.asyncio
    async def test_offset(self, repo, session: AsyncSession) -> None:
        for i in range(3):
            await repo.create_conversation(session, title=f"Convo {i}")
        items, total = await repo.list_conversations(session, limit=10, offset=2)
        assert len(items) == 1
        assert total == 3


class TestUpdateConversation:
    @pytest.mark.asyncio
    async def test_update_status(self, repo, session: AsyncSession) -> None:
        created = await repo.create_conversation(session, title="Update me")
        updated = await repo.update_conversation(
            session, created.id, status="completed"
        )
        assert updated.status == "completed"

    @pytest.mark.asyncio
    async def test_update_title(self, repo, session: AsyncSession) -> None:
        created = await repo.create_conversation(session, title="Old")
        updated = await repo.update_conversation(session, created.id, title="New")
        assert updated.title == "New"


class TestMessages:
    @pytest.mark.asyncio
    async def test_save_and_get_messages(self, repo, session: AsyncSession) -> None:
        convo = await repo.create_conversation(session, title="Messages test")
        await repo.save_message(
            session, convo.id, role="user", content={"text": "hello"}, iteration=None
        )
        await repo.save_message(
            session,
            convo.id,
            role="assistant",
            content={"text": "hi there"},
            iteration=1,
        )
        messages = await repo.get_messages(session, convo.id)
        assert len(messages) == 2
        assert messages[0].role == "user"
        assert messages[1].role == "assistant"
        assert messages[1].iteration == 1


class TestEvents:
    @pytest.mark.asyncio
    async def test_save_and_get_events(self, repo, session: AsyncSession) -> None:
        convo = await repo.create_conversation(session, title="Events test")
        await repo.save_event(
            session,
            convo.id,
            event_type="task_start",
            data={"message": "hello"},
            iteration=1,
        )
        events = await repo.get_events(session, convo.id, limit=10, offset=0)
        assert len(events) == 1
        assert events[0].event_type == "task_start"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_repository.py -v`
Expected: FAIL with `ImportError` (ConversationRepository doesn't exist yet with new signature)

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `backend/agent/state/repository.py`:

```python
"""PostgreSQL repository for conversation persistence.

All methods receive an ``AsyncSession`` via dependency injection.
All returned records are frozen dataclasses from ``schemas.py`` —
ORM models never leak beyond this module.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.state.models import (
    AgentRunModel,
    ConversationModel,
    EventModel,
    MessageModel,
)
from agent.state.schemas import (
    AgentRunRecord,
    ConversationRecord,
    EventRecord,
    MessageRecord,
)


def _to_conversation(model: ConversationModel) -> ConversationRecord:
    return ConversationRecord(
        id=model.id,
        title=model.title,
        status=model.status,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_message(model: MessageModel) -> MessageRecord:
    return MessageRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        role=model.role,
        content=model.content,
        iteration=model.iteration,
        created_at=model.created_at,
    )


def _to_event(model: EventModel) -> EventRecord:
    return EventRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        event_type=model.event_type,
        data=model.data,
        iteration=model.iteration,
        timestamp=model.timestamp,
    )


def _to_agent_run(model: AgentRunModel) -> AgentRunRecord:
    return AgentRunRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        config=model.config,
        status=model.status,
        result=model.result,
        created_at=model.created_at,
    )


class ConversationRepository:
    """Async repository for conversation persistence backed by PostgreSQL."""

    async def create_conversation(
        self,
        session: AsyncSession,
        title: str | None = None,
    ) -> ConversationRecord:
        model = ConversationModel(id=uuid.uuid4(), title=title)
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_conversation(model)

    async def get_conversation(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> ConversationRecord | None:
        stmt = select(ConversationModel).where(
            ConversationModel.id == conversation_id
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_conversation(model) if model else None

    async def list_conversations(
        self,
        session: AsyncSession,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[ConversationRecord], int]:
        count_stmt = select(func.count()).select_from(ConversationModel)
        total = (await session.execute(count_stmt)).scalar_one()

        stmt = (
            select(ConversationModel)
            .order_by(ConversationModel.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await session.execute(stmt)
        items = [_to_conversation(m) for m in result.scalars().all()]
        return items, total

    async def update_conversation(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        status: str | None = None,
        title: str | None = None,
    ) -> ConversationRecord:
        stmt = select(ConversationModel).where(
            ConversationModel.id == conversation_id
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            raise ValueError(f"Conversation not found: {conversation_id}")

        if status is not None:
            model.status = status
        if title is not None:
            model.title = title
        model.updated_at = datetime.now(timezone.utc)

        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_conversation(model)

    async def save_message(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        role: str,
        content: dict,
        iteration: int | None = None,
    ) -> MessageRecord:
        model = MessageModel(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            role=role,
            content=content,
            iteration=iteration,
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_message(model)

    async def get_messages(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> list[MessageRecord]:
        stmt = (
            select(MessageModel)
            .where(MessageModel.conversation_id == conversation_id)
            .order_by(MessageModel.created_at.asc())
        )
        result = await session.execute(stmt)
        return [_to_message(m) for m in result.scalars().all()]

    async def save_event(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        event_type: str,
        data: dict,
        iteration: int | None = None,
    ) -> None:
        model = EventModel(
            conversation_id=conversation_id,
            event_type=event_type,
            data=data,
            iteration=iteration,
        )
        session.add(model)
        await session.commit()

    async def get_events(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        limit: int = 1000,
        offset: int = 0,
    ) -> list[EventRecord]:
        stmt = (
            select(EventModel)
            .where(EventModel.conversation_id == conversation_id)
            .order_by(EventModel.timestamp.asc())
            .limit(limit)
            .offset(offset)
        )
        result = await session.execute(stmt)
        return [_to_event(m) for m in result.scalars().all()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_repository.py -v`
Expected: All tests PASS.

Note: This requires a running PostgreSQL with a `synapse_test` database. Create it first if needed:
```bash
createdb -U ha synapse_test
```

- [ ] **Step 5: Commit**

```bash
git add backend/agent/state/repository.py backend/tests/test_repository.py
git commit -m "feat: rewrite repository for PostgreSQL with async SQLAlchemy"
```

---

### Task 7: Set up Alembic with initial migration

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/migrations/env.py`
- Create: `backend/migrations/script.py.mako`
- Create: `backend/migrations/versions/001_initial_schema.py`

- [ ] **Step 1: Initialize Alembic scaffold**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run alembic init migrations`

This creates `alembic.ini` and `migrations/` directory with template files.

- [ ] **Step 2: Configure alembic.ini**

In `backend/alembic.ini`, replace the `sqlalchemy.url` line with a placeholder (we'll read it from settings at runtime):

```ini
sqlalchemy.url = postgresql+asyncpg://ha:ha@localhost:5432/synapse
```

- [ ] **Step 3: Rewrite migrations/env.py for async support**

Replace the entire `backend/migrations/env.py`:

```python
"""Alembic environment configuration — async-aware."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from agent.state.models import Base
from config.settings import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_url() -> str:
    """Resolve DATABASE_URL from application settings."""
    return get_settings().DATABASE_URL


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with async engine."""
    engine = create_async_engine(_get_url())
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    """Entry point for online migrations."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4: Create the initial migration**

Create `backend/migrations/versions/001_initial_schema.py`:

```python
"""Initial schema: conversations, messages, events, agent_runs.

Revision ID: 001
Revises:
Create Date: 2026-03-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- conversations ---
    op.create_table(
        "conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="ck_conversations_status",
        ),
    )

    # --- messages ---
    op.create_table(
        "messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", JSONB, nullable=False),
        sa.Column("iteration", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant', 'tool')",
            name="ck_messages_role",
        ),
    )
    op.create_index(
        "ix_messages_conversation_created",
        "messages",
        ["conversation_id", "created_at"],
    )

    # --- events ---
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("iteration", sa.Integer, nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_events_conversation_timestamp",
        "events",
        ["conversation_id", "timestamp"],
    )
    op.create_index(
        "ix_events_conversation_type",
        "events",
        ["conversation_id", "event_type"],
    )

    # --- agent_runs ---
    op.create_table(
        "agent_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("config", JSONB, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("result", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_agent_runs_conversation",
        "agent_runs",
        ["conversation_id"],
    )

    # --- updated_at trigger ---
    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_conversations_updated_at
        BEFORE UPDATE ON conversations
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")
    op.drop_table("agent_runs")
    op.drop_table("events")
    op.drop_table("messages")
    op.drop_table("conversations")
```

- [ ] **Step 5: Run the migration**

```bash
cd /Users/feihe/Workspace/Synapse/backend && createdb -U ha synapse 2>/dev/null; uv run alembic upgrade head
```

Expected: Migration applies successfully. Tables created.

- [ ] **Step 6: Verify tables exist**

Run: `psql -U ha -d synapse -c "\dt"`
Expected: Lists `conversations`, `messages`, `events`, `agent_runs` tables.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic.ini backend/migrations/
git commit -m "feat: add Alembic with initial PostgreSQL migration"
```

---

## Chunk 3: API Integration (DB subscriber, new endpoints, main.py changes)

### Task 8: Create DB event subscriber

**Files:**
- Create: `backend/api/db_subscriber.py`
- Test: `backend/tests/test_db_subscriber.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_db_subscriber.py`:

```python
"""Tests for the database event subscriber."""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.db_subscriber import create_db_subscriber
from api.events import AgentEvent, EventType


def _make_event(event_type: EventType, data: dict, iteration: int | None = None) -> AgentEvent:
    return AgentEvent(type=event_type, data=data, iteration=iteration)


@pytest.mark.asyncio
async def test_persists_turn_start_as_user_message() -> None:
    repo = AsyncMock()
    session_factory = AsyncMock()
    session = AsyncMock()
    session_factory.return_value.__aenter__ = AsyncMock(return_value=session)
    session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)

    event = _make_event(EventType.TURN_START, {"message": "hello"})
    await subscriber(event)

    repo.save_message.assert_called_once()
    call_args = repo.save_message.call_args
    assert call_args[1]["role"] == "user" or call_args[0][2] == "user"


@pytest.mark.asyncio
async def test_persists_turn_complete_as_assistant_message() -> None:
    repo = AsyncMock()
    session_factory = AsyncMock()
    session = AsyncMock()
    session_factory.return_value.__aenter__ = AsyncMock(return_value=session)
    session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)

    event = _make_event(EventType.TURN_COMPLETE, {"result": "done"})
    await subscriber(event)

    repo.save_message.assert_called_once()
    repo.update_conversation.assert_called_once()


@pytest.mark.asyncio
async def test_persists_generic_event() -> None:
    repo = AsyncMock()
    session_factory = AsyncMock()
    session = AsyncMock()
    session_factory.return_value.__aenter__ = AsyncMock(return_value=session)
    session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)

    event = _make_event(EventType.TOOL_CALL, {"tool": "web_search"}, iteration=2)
    await subscriber(event)

    repo.save_event.assert_called_once()


@pytest.mark.asyncio
async def test_db_failure_does_not_raise() -> None:
    repo = AsyncMock()
    repo.save_event.side_effect = Exception("DB down")
    session_factory = AsyncMock()
    session = AsyncMock()
    session_factory.return_value.__aenter__ = AsyncMock(return_value=session)
    session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    conversation_id = uuid.uuid4()
    subscriber = create_db_subscriber(conversation_id, repo, session_factory)

    event = _make_event(EventType.TOOL_CALL, {"tool": "test"})
    # Should not raise
    await subscriber(event)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_db_subscriber.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

Create `backend/api/db_subscriber.py`:

```python
"""Database event subscriber for persisting agent events to PostgreSQL.

Registered on the EventEmitter for each conversation. Persists events,
messages, and status updates without coupling the orchestrator to the
database. Failures are logged but never propagate to the agent loop.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent.state.repository import ConversationRepository
from api.events import AgentEvent, EventType

# Event types that map to message persistence
_MESSAGE_EVENTS = {EventType.TURN_START, EventType.TURN_COMPLETE, EventType.TASK_COMPLETE}

# Event types that should not be persisted (too noisy or ephemeral)
_SKIP_EVENTS = {EventType.TEXT_DELTA}


def _clean_data(data: dict[str, Any]) -> dict[str, Any]:
    """Remove non-serializable entries (e.g. callbacks) from event data."""
    return {
        k: v for k, v in data.items()
        if not callable(v) and k != "response_callback"
    }


def create_db_subscriber(
    conversation_id: uuid.UUID,
    repo: ConversationRepository,
    session_factory: async_sessionmaker[AsyncSession],
) -> Any:
    """Create an async event subscriber that persists to PostgreSQL.

    Args:
        conversation_id: The conversation this subscriber is for.
        repo: The conversation repository.
        session_factory: Factory for creating async sessions.

    Returns:
        An async callback suitable for EventEmitter.subscribe().
    """

    async def _subscriber(event: AgentEvent) -> None:
        if event.type in _SKIP_EVENTS:
            return

        try:
            async with session_factory() as session:
                clean = _clean_data(event.data)

                if event.type == EventType.TURN_START:
                    message = clean.get("message", "")
                    await repo.save_message(
                        session,
                        conversation_id,
                        role="user",
                        content={"text": message},
                        iteration=None,
                    )

                elif event.type == EventType.TURN_COMPLETE:
                    result = clean.get("result", "")
                    await repo.save_message(
                        session,
                        conversation_id,
                        role="assistant",
                        content={"text": result},
                        iteration=event.iteration,
                    )
                    # Turn complete does not mean conversation complete
                    # (multi-turn conversations continue)

                elif event.type == EventType.TASK_COMPLETE:
                    result = clean.get("summary", clean.get("result", ""))
                    await repo.save_message(
                        session,
                        conversation_id,
                        role="assistant",
                        content={"text": result},
                        iteration=event.iteration,
                    )
                    await repo.update_conversation(
                        session, conversation_id, status="completed"
                    )

                elif event.type == EventType.TASK_ERROR:
                    await repo.update_conversation(
                        session, conversation_id, status="failed"
                    )
                    await repo.save_event(
                        session,
                        conversation_id,
                        event_type=event.type.value,
                        data=clean,
                        iteration=event.iteration,
                    )

                elif event.type == EventType.CONVERSATION_TITLE:
                    title = clean.get("title", "")
                    if title:
                        await repo.update_conversation(
                            session, conversation_id, title=title
                        )

                else:
                    await repo.save_event(
                        session,
                        conversation_id,
                        event_type=event.type.value,
                        data=clean,
                        iteration=event.iteration,
                    )

        except Exception:
            logger.warning(
                "db_subscriber_failed conversation_id={} event_type={}",
                conversation_id,
                event.type,
                exc_info=True,
            )

    return _subscriber
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/feihe/Workspace/Synapse/backend && uv run pytest tests/test_db_subscriber.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/db_subscriber.py backend/tests/test_db_subscriber.py
git commit -m "feat: add database event subscriber for persistence"
```

---

### Task 9: Integrate PostgreSQL into main.py

**Files:**
- Modify: `backend/api/main.py`

This is the largest change. Modifications:
1. Import database module and repository
2. Create engine/session factory at app startup
3. Wire DB subscriber into conversation creation
4. Add `GET /conversations` (paginated) endpoint
5. Add `GET /conversations/{id}/messages` endpoint
6. Inject session dependency

- [ ] **Step 1: Add imports at top of main.py**

After the existing imports, add:

```python
from functools import partial

from agent.state.database import get_engine, get_session, get_session_factory, init_db
from agent.state.repository import ConversationRepository
from api.db_subscriber import create_db_subscriber
```

- [ ] **Step 2: Add DB initialization to _create_app()**

Inside `_create_app()`, after `sandbox_provider, sandbox_pool = _build_sandbox_provider()`, add:

```python
    # Database setup
    settings_db = get_settings()
    db_engine = get_engine(settings_db.DATABASE_URL)
    db_session_factory = get_session_factory(db_engine)
    db_repo = ConversationRepository()

    # FastAPI dependency for DB sessions
    async def _get_db_session():
        async for session in get_session(db_session_factory):
            yield session
```

- [ ] **Step 3: Add startup/shutdown hooks for database**

In the `_start_cleanup_task` startup event, add:

```python
        await init_db(db_engine)
```

Add a new shutdown event:

```python
    @application.on_event("shutdown")
    async def _dispose_db_engine() -> None:
        await db_engine.dispose()
        logger.info("database_engine_disposed")
```

- [ ] **Step 4: Wire DB subscriber into create_conversation()**

In the `create_conversation()` endpoint, after `_conversations[conversation_id] = entry`, add:

```python
        # Persist conversation and register DB subscriber
        async with db_session_factory() as session:
            await db_repo.create_conversation(
                session, title=request.message[:80]
            )

        conv_uuid = uuid.UUID(conversation_id)
        db_sub = create_db_subscriber(conv_uuid, db_repo, db_session_factory)
        emitter.subscribe(db_sub)
```

- [ ] **Step 5: Wire DB subscriber into send_message() for resumed conversations**

In the `send_message()` endpoint, after the `entry is None` check, the existing conversation is already in memory. No DB subscriber change needed — it was registered at creation time. But we should update `updated_at`:

After `entry.turn_task = asyncio.create_task(...)`, add:

```python
        # Update conversation timestamp
        try:
            async with db_session_factory() as session:
                await db_repo.update_conversation(
                    session, uuid.UUID(conversation_id), status="running"
                )
        except Exception:
            logger.warning("failed_to_update_conversation_timestamp id=%s", conversation_id)
```

- [ ] **Step 6: Add GET /conversations endpoint**

Add after the existing endpoints, before the `return application` line:

```python
    @application.get("/conversations", dependencies=_deps)
    async def list_conversations(
        limit: int = 20,
        offset: int = 0,
        session: Any = Depends(_get_db_session),
    ) -> dict[str, Any]:
        """List conversations, paginated, newest first."""
        if limit > 100:
            limit = 100
        items, total = await db_repo.list_conversations(session, limit=limit, offset=offset)
        return {
            "items": [
                {
                    "id": str(item.id),
                    "title": item.title,
                    "status": item.status,
                    "created_at": item.created_at.isoformat(),
                    "updated_at": item.updated_at.isoformat(),
                }
                for item in items
            ],
            "total": total,
        }

    @application.get(
        "/conversations/{conversation_id}/messages",
        dependencies=_deps,
    )
    async def get_conversation_messages(
        conversation_id: str = Path(..., pattern=_UUID_PATTERN),
        session: Any = Depends(_get_db_session),
    ) -> dict[str, Any]:
        """Get all messages for a conversation (for history replay)."""
        conv_uuid = uuid.UUID(conversation_id)
        convo = await db_repo.get_conversation(session, conv_uuid)
        if convo is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        messages = await db_repo.get_messages(session, conv_uuid)
        return {
            "conversation_id": str(convo.id),
            "title": convo.title,
            "status": convo.status,
            "messages": [
                {
                    "id": str(m.id),
                    "role": m.role,
                    "content": m.content,
                    "iteration": m.iteration,
                    "created_at": m.created_at.isoformat(),
                }
                for m in messages
            ],
        }
```

- [ ] **Step 7: Verify the app starts**

Run: `cd /Users/feihe/Workspace/Synapse/backend && timeout 5 uv run python -m api.main 2>&1 || true`
Expected: App starts, logs `database_connection_verified`. May timeout after 5s — that's fine.

- [ ] **Step 8: Commit**

```bash
git add backend/api/main.py
git commit -m "feat: integrate PostgreSQL into FastAPI app with DB subscriber and new endpoints"
```

---

## Chunk 4: Frontend Changes

### Task 10: Create history API client

**Files:**
- Create: `web/src/features/conversation/api/history-api.ts`

- [ ] **Step 1: Create the API client**

Create `web/src/features/conversation/api/history-api.ts`:

```typescript
import { API_BASE } from "@/shared/constants";

export interface ConversationListItem {
  readonly id: string;
  readonly title: string | null;
  readonly status: "running" | "completed" | "failed";
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ConversationListResponse {
  readonly items: readonly ConversationListItem[];
  readonly total: number;
}

export interface HistoryMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool";
  readonly content: Record<string, unknown>;
  readonly iteration: number | null;
  readonly created_at: string;
}

export interface ConversationMessagesResponse {
  readonly conversation_id: string;
  readonly title: string | null;
  readonly status: string;
  readonly messages: readonly HistoryMessage[];
}

export async function fetchConversations(
  limit = 20,
  offset = 0,
): Promise<ConversationListResponse> {
  const res = await fetch(
    `${API_BASE}/conversations?limit=${limit}&offset=${offset}`,
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch conversations: ${res.status}`);
  }

  return res.json();
}

export async function fetchMessages(
  conversationId: string,
): Promise<ConversationMessagesResponse> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages`,
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch messages: ${res.status}`);
  }

  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/features/conversation/api/history-api.ts
git commit -m "feat: add history API client for conversations and messages"
```

---

### Task 11: Update app-store.ts for server-fetched conversation list

**Files:**
- Modify: `web/src/shared/stores/app-store.ts`

- [ ] **Step 1: Rewrite app-store.ts**

Replace the entire contents of `web/src/shared/stores/app-store.ts`:

```typescript
import { create } from "zustand";
import {
  fetchConversations,
  type ConversationListItem,
} from "@/features/conversation/api/history-api";

export interface ConversationHistoryItem {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "complete" | "error";
  readonly timestamp: number;
}

function toHistoryItem(item: ConversationListItem): ConversationHistoryItem {
  return {
    id: item.id,
    title: item.title ?? "Untitled",
    status: item.status === "failed" ? "error" : item.status === "completed" ? "complete" : "running",
    timestamp: new Date(item.created_at).getTime(),
  };
}

interface AppState {
  // Conversation
  readonly conversationId: string | null;
  readonly conversationHistory: readonly ConversationHistoryItem[];
  readonly totalConversations: number;
  readonly isLoadingHistory: boolean;

  // UI
  readonly sidebarCollapsed: boolean;

  // Actions
  readonly startConversation: (conversationId: string, title: string) => void;
  readonly updateConversationStatus: (conversationId: string, status: ConversationHistoryItem["status"]) => void;
  readonly updateConversationTitle: (conversationId: string, title: string) => void;
  readonly switchConversation: (conversationId: string) => void;
  readonly resetConversation: () => void;
  readonly toggleSidebar: () => void;
  readonly loadConversations: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
}

const PAGE_SIZE = 20;

export const useAppStore = create<AppState>((set, get) => ({
  conversationId: null,
  conversationHistory: [],
  totalConversations: 0,
  isLoadingHistory: false,
  sidebarCollapsed: false,

  startConversation: (conversationId, title) =>
    set((state) => ({
      conversationId,
      conversationHistory: [
        { id: conversationId, title: title.slice(0, 80), status: "running" as const, timestamp: Date.now() },
        ...state.conversationHistory.filter((c) => c.id !== conversationId),
      ],
      totalConversations: state.totalConversations + 1,
    })),

  updateConversationStatus: (conversationId, status) =>
    set((state) => ({
      conversationHistory: state.conversationHistory.map((c) =>
        c.id === conversationId ? { ...c, status } : c
      ),
    })),

  updateConversationTitle: (conversationId, title) =>
    set((state) => ({
      conversationHistory: state.conversationHistory.map((c) =>
        c.id === conversationId ? { ...c, title } : c
      ),
    })),

  switchConversation: (conversationId) =>
    set({ conversationId }),

  resetConversation: () => set({ conversationId: null }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  loadConversations: async () => {
    set({ isLoadingHistory: true });
    try {
      const { items, total } = await fetchConversations(PAGE_SIZE, 0);
      set({
        conversationHistory: items.map(toHistoryItem),
        totalConversations: total,
      });
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      set({ isLoadingHistory: false });
    }
  },

  loadMore: async () => {
    const { conversationHistory, totalConversations, isLoadingHistory } = get();
    if (isLoadingHistory || conversationHistory.length >= totalConversations) return;

    set({ isLoadingHistory: true });
    try {
      const { items, total } = await fetchConversations(
        PAGE_SIZE,
        conversationHistory.length,
      );
      set((state) => ({
        conversationHistory: [
          ...state.conversationHistory,
          ...items.map(toHistoryItem).filter(
            (item) => !state.conversationHistory.some((c) => c.id === item.id),
          ),
        ],
        totalConversations: total,
      }));
    } catch (err) {
      console.error("Failed to load more conversations:", err);
    } finally {
      set({ isLoadingHistory: false });
    }
  },
}));
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/shared/stores/app-store.ts
git commit -m "feat: update app store to fetch conversation history from backend"
```

---

### Task 12: Add scroll-to-bottom detection to Sidebar

**Files:**
- Modify: `web/src/shared/components/Sidebar.tsx`

- [ ] **Step 1: Add onLoadMore prop and scroll detection**

In `web/src/shared/components/Sidebar.tsx`:

Add `onLoadMore?: () => void;` to the `SidebarProps` interface.

Add `onLoadMore` to the destructured props.

Replace the `<ScrollArea>` section (the task list area) with a version that detects scroll-to-bottom:

```tsx
      {/* Task list */}
      <div className={cn("flex flex-1 flex-col overflow-hidden", collapsed ? "px-2" : "px-3")}>
        <ScrollArea
          className="flex-1"
          onScrollCapture={(e) => {
            if (!onLoadMore) return;
            const target = e.currentTarget;
            const scrollEl = target.querySelector("[data-radix-scroll-area-viewport]");
            if (!scrollEl) return;
            const { scrollTop, scrollHeight, clientHeight } = scrollEl;
            if (scrollHeight - scrollTop - clientHeight < 100) {
              onLoadMore();
            }
          }}
        >
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/shared/components/Sidebar.tsx
git commit -m "feat: add infinite scroll support to Sidebar"
```

---

### Task 13: Wire ConversationSidebar to load from backend

**Files:**
- Modify: `web/src/features/conversation/components/ConversationSidebar.tsx`

- [ ] **Step 1: Add useEffect to load conversations on mount and pass onLoadMore**

Replace `web/src/features/conversation/components/ConversationSidebar.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { Sidebar } from "@/shared/components";
import { useAppStore } from "@/shared/stores";
import { useConversationContext } from "../hooks/use-conversation-context";

export function ConversationSidebar() {
  const { conversationId, handleSwitchConversation, handleNewConversation } =
    useConversationContext();
  const {
    conversationHistory,
    sidebarCollapsed,
    toggleSidebar,
    loadConversations,
    loadMore,
  } = useAppStore();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <Sidebar
      taskHistory={conversationHistory}
      activeTaskId={conversationId}
      onNewTask={handleNewConversation}
      onSelectTask={handleSwitchConversation}
      collapsed={sidebarCollapsed}
      onToggle={toggleSidebar}
      onLoadMore={loadMore}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/conversation/components/ConversationSidebar.tsx
git commit -m "feat: load conversation history from backend on sidebar mount"
```

---

### Task 13.5: Update ConversationProvider to remove stale context fields

**Files:**
- Modify: `web/src/features/conversation/components/ConversationProvider.tsx`
- Modify: `web/src/features/conversation/hooks/use-conversation.ts`

The `ConversationProvider` currently exposes `conversationHistory` and `sidebarCollapsed` via context (sourced from `useConversation` hook which reads `useAppStore`). Since the sidebar now reads directly from `useAppStore`, these fields create a redundant data path. Remove them from the context to avoid inconsistency.

- [ ] **Step 1: Remove `conversationHistory` and `sidebarCollapsed` from useConversation return**

In `web/src/features/conversation/hooks/use-conversation.ts`, remove `conversationHistory` and `sidebarCollapsed` from the destructured `useAppStore()` call and from the return object:

```typescript
  const {
    conversationId,
    startConversation,
    switchConversation,
    updateConversationStatus,
    updateConversationTitle,
    resetConversation,
  } = useAppStore();
```

Update the return:

```typescript
  return {
    conversationId,
    allMessages,
    handleSendMessage,
    handleCreateConversation,
    handleSwitchConversation,
    handleNewConversation,
  };
```

- [ ] **Step 2: Remove from ConversationProvider context**

In `web/src/features/conversation/components/ConversationProvider.tsx`:

Remove `conversationHistory` and `sidebarCollapsed` from `ConversationContextValue` interface and from the `value` object. Also remove `toggleSidebar` from the provider (sidebar now manages its own state via `useAppStore`).

Update the interface — remove these lines:
```typescript
  readonly conversationHistory: ...;
  readonly sidebarCollapsed: boolean;
  readonly toggleSidebar: () => void;
```

Remove from the value object:
```typescript
    conversationHistory,
    sidebarCollapsed,
    toggleSidebar,
```

Also remove the `toggleSidebar` import from `useAppStore` at the top.

- [ ] **Step 3: Verify build**

Run: `cd /Users/feihe/Workspace/Synapse/web && npm run build`
Expected: Build succeeds. (If any other components read `conversationHistory` or `sidebarCollapsed` from context, they need to be updated to use `useAppStore` directly — check build errors.)

- [ ] **Step 4: Commit**

```bash
git add web/src/features/conversation/components/ConversationProvider.tsx web/src/features/conversation/hooks/use-conversation.ts
git commit -m "refactor: remove redundant conversationHistory from context, use store directly"
```

---

## Chunk 5: Cleanup & Verification

### Task 14: Delete old SQLite file and update __init__.py

**Files:**
- Delete: `backend/synapse.db` (if exists)
- Modify: `backend/agent/state/__init__.py`

- [ ] **Step 1: Remove SQLite database file if it exists**

```bash
rm -f /Users/feihe/Workspace/Synapse/backend/synapse.db
```

- [ ] **Step 2: Update __init__.py to export new modules**

If `backend/agent/state/__init__.py` is empty, add:

```python
"""State persistence layer — PostgreSQL backed."""
```

- [ ] **Step 3: Commit**

```bash
git add backend/agent/state/__init__.py
git commit -m "chore: clean up SQLite artifacts and update state module"
```

---

### Task 15: End-to-end verification

- [ ] **Step 1: Ensure PostgreSQL is running and database exists**

```bash
createdb -U ha synapse 2>/dev/null; echo "DB ready"
```

- [ ] **Step 2: Run migrations**

```bash
cd /Users/feihe/Workspace/Synapse/backend && uv run alembic upgrade head
```

Expected: Migration applies (or is already at head).

- [ ] **Step 3: Run all backend tests**

```bash
cd /Users/feihe/Workspace/Synapse/backend && uv run pytest -v
```

Expected: All tests pass.

- [ ] **Step 4: Start the backend and verify new endpoints**

Start: `cd /Users/feihe/Workspace/Synapse && make backend`

In another terminal:
```bash
# List conversations (should return empty)
curl -s http://localhost:8000/conversations | python3 -m json.tool

# Expected: {"items": [], "total": 0}
```

- [ ] **Step 5: Build the frontend**

```bash
cd /Users/feihe/Workspace/Synapse/web && npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Full stack smoke test**

Start both: `make dev`

1. Open http://localhost:3000
2. Send a message — conversation should appear in sidebar
3. Refresh the page — sidebar should still show the conversation (fetched from PG)
4. Click a past conversation — should load message history

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete PostgreSQL storage migration"
```
