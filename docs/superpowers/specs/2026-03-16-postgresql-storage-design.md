# PostgreSQL Storage Migration

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Replace in-memory + SQLite storage with PostgreSQL as single source of truth

## Goals

1. PostgreSQL as the single persistent store for conversations, messages, events, and agent runs
2. Full history for replay, search, and usage analytics
3. Eliminate the unused SQLite layer entirely
4. Frontend sidebar loads conversation history from the backend (paginated)

## Database Schema

Four tables, all using `TIMESTAMPTZ` and `JSONB` where appropriate.

### conversations

| Column     | Type          | Constraints                  |
|------------|---------------|------------------------------|
| id         | UUID          | PK                           |
| title      | VARCHAR(200)  | nullable                     |
| status     | VARCHAR(20)   | NOT NULL, default 'running', CHECK IN ('running', 'completed', 'failed') |
| created_at | TIMESTAMPTZ   | NOT NULL, default now()      |
| updated_at | TIMESTAMPTZ   | NOT NULL, default now(), updated via trigger |

Trigger: `set_updated_at` — automatically sets `updated_at = now()` on every UPDATE.

### messages

| Column          | Type         | Constraints                          |
|-----------------|--------------|--------------------------------------|
| id              | UUID         | PK                                   |
| conversation_id | UUID         | FK → conversations.id ON DELETE CASCADE, NOT NULL |
| role            | VARCHAR(20)  | NOT NULL, CHECK IN ('user', 'assistant', 'tool') |
| content         | JSONB        | NOT NULL — text + tool_use blocks    |
| iteration       | INT          | nullable                             |
| created_at      | TIMESTAMPTZ  | NOT NULL, default now()              |

Index: `(conversation_id, created_at)`

### events

| Column          | Type         | Constraints                          |
|-----------------|--------------|--------------------------------------|
| id              | BIGSERIAL    | PK                                   |
| conversation_id | UUID         | FK → conversations.id ON DELETE CASCADE, NOT NULL |
| event_type      | VARCHAR(50)  | NOT NULL                             |
| data            | JSONB        | NOT NULL                             |
| iteration       | INT          | nullable                             |
| timestamp       | TIMESTAMPTZ  | NOT NULL                             |

Indexes: `(conversation_id, timestamp)`, `(conversation_id, event_type)`

Note: The events table will grow fast (~20-50 events per iteration, up to 50 iterations per conversation). Consider range partitioning by month on `timestamp` when volume warrants it.

### agent_runs

| Column          | Type         | Constraints                          |
|-----------------|--------------|--------------------------------------|
| id              | UUID         | PK                                   |
| conversation_id | UUID         | FK → conversations.id ON DELETE CASCADE, NOT NULL |
| config          | JSONB        | NOT NULL                             |
| status          | VARCHAR(20)  | NOT NULL                             |
| result          | JSONB        | nullable                             |
| created_at      | TIMESTAMPTZ  | NOT NULL, default now()              |

Index: `(conversation_id)`

## Backend Architecture

### File Structure

```
backend/agent/state/
├── database.py      — async engine, session factory, init_db()
├── models.py        — SQLAlchemy ORM models (replaces old frozen dataclasses)
├── repository.py    — async repository using SQLAlchemy sessions
└── schemas.py       — frozen dataclasses as read-only DTOs
```

### database.py

- Creates `AsyncEngine` from `DATABASE_URL` setting using `asyncpg` driver
- Connection pool: `pool_size=10`, `max_overflow=20`, `pool_timeout=30`
- Exposes `async_sessionmaker` for session creation
- `init_db()` verifies the connection at startup (does NOT auto-create tables — Alembic handles that)
- `get_session()` as a FastAPI dependency yielding `AsyncSession`

### models.py

SQLAlchemy ORM mapped classes:

- `ConversationModel` — maps to `conversations` table, has relationships to messages, events, agent_runs
- `MessageModel` — maps to `messages` table
- `EventModel` — maps to `events` table
- `AgentRunModel` — maps to `agent_runs` table

ORM models are **strictly internal to the repository layer**. They must never be returned from repository methods or leak beyond `repository.py`. All public APIs return frozen DTOs from `schemas.py`.

### schemas.py

Frozen dataclasses returned at API boundaries:

- `ConversationRecord(id, title, status, created_at, updated_at)`
- `MessageRecord(id, conversation_id, role, content, iteration, created_at)`
- `EventRecord(id, conversation_id, event_type, data, iteration, timestamp)`
- `AgentRunRecord(id, conversation_id, config, status, result, created_at)`

### repository.py

`ConversationRepository` class, receives `AsyncSession` via dependency injection:

- `create_conversation(title) -> ConversationRecord`
- `get_conversation(id) -> ConversationRecord | None`
- `list_conversations(limit, offset) -> tuple[list[ConversationRecord], int]` — returns items + total count
- `update_conversation(id, status=None, title=None) -> ConversationRecord`
- `save_message(conversation_id, role, content, iteration=None) -> MessageRecord`
- `get_messages(conversation_id) -> list[MessageRecord]`
- `save_event(conversation_id, event) -> None`
- `get_events(conversation_id, limit=1000, offset=0) -> list[EventRecord]`

## API Changes

### New Endpoints

| Method | Path                              | Purpose                                        |
|--------|-----------------------------------|------------------------------------------------|
| GET    | `/conversations`                  | Paginated list: `?limit=20&offset=0` → `{items, total}` |
| GET    | `/conversations/{id}/messages`    | Full message history for replay                |

### Modified Endpoints

- **`POST /conversations`** — persists conversation to PG before returning. Still starts the SSE turn.
- **`POST /conversations/{id}/messages`** — saves user message to PG. Assistant messages and events are persisted during the orchestrator loop.
- **`POST /conversations/{id}/respond`** — unchanged. User responses to `ask_user` prompts are not persisted as messages (they are ephemeral tool inputs).
- **`GET /conversations/{id}/events`** — unchanged for live SSE streaming.

### In-Memory Runtime Dict

`_conversations: dict[str, ConversationEntry]` is kept but scoped to **runtime state only**:

- `emitter` — EventEmitter for pub/sub
- `event_queue` — asyncio.Queue for SSE streaming
- `pending_callbacks` — user prompt responses
- `turn_task` — current running asyncio.Task

No persistent data lives in this dict. On reconnect after restart, the frontend fetches history from PG. Sending a new message re-creates the runtime entry.

### Persistence Integration

Messages and events are persisted via an **event subscriber** on the `EventEmitter`. This avoids coupling the orchestrator to the database:

1. On conversation creation, register a `_db_subscriber` on the emitter
2. The subscriber receives every `AgentEvent` and persists it to the `events` table
3. For `TURN_START` events, save the user message to the `messages` table
4. For `TURN_COMPLETE` / `TASK_ERROR` events, save the assistant message and update conversation status
5. The orchestrator remains database-unaware — persistence is a side effect of event emission

If PG becomes unreachable mid-conversation, the subscriber logs the error but does not fail the turn. The agent loop continues; events may be lost but the user experience is not interrupted.

### Settings

Add to `config/settings.py`:

```python
DATABASE_URL: str = "postgresql+asyncpg://ha:ha@localhost:5432/synapse"
```

## Alembic Setup

### Structure

```
backend/
├── alembic.ini
├── migrations/
│   ├── env.py                      — async-aware, reads DATABASE_URL from settings
│   ├── script.py.mako
│   └── versions/
│       └── 001_initial_schema.py   — creates all 4 tables + indexes
```

### Details

- `env.py` uses async engine runner for `asyncpg` compatibility
- `sqlalchemy.url` resolved from `DATABASE_URL` setting at runtime, not hardcoded in `alembic.ini`
- Migrations run manually via `alembic upgrade head` (not auto-applied at startup)

## Frontend Changes

### API Client

New file `src/shared/api/conversations.ts`:

- `fetchConversations(limit, offset)` — paginated list from `GET /conversations`
- `fetchMessages(conversationId)` — full history from `GET /conversations/{id}/messages`

### app-store.ts

- Remove client-side `conversationHistory` array
- Add `conversations` state populated from API
- Add `loadConversations(limit, offset)` action — called on mount
- Add `loadMore()` for infinite scroll pagination

### Sidebar

- On mount: fetch first page of conversations
- On scroll to bottom: fetch next page
- On click: if live → switch SSE connection. If historical → fetch messages and render read-only.
- Sending a message in a historical conversation re-creates the backend runtime entry

## Deletions

- `backend/agent/state/models.py` — old SQLite frozen dataclasses (replaced by ORM models + schemas)
- `backend/agent/state/repository.py` — old SQLite repository (rewritten for PostgreSQL)
- `synapse.db` — SQLite database file (no migration path, was unused)

## Dependencies

### Backend (add to pyproject.toml)

- `sqlalchemy[asyncio]` — async ORM
- `asyncpg` — PostgreSQL async driver
- `alembic` — schema migrations

### Frontend

No new dependencies.

## Startup Flow

1. `alembic upgrade head` (manual or CI)
2. App starts → `init_db()` verifies PG connection
3. Endpoints use `get_session()` dependency for DB access
4. In-memory dict handles live runtime state only
