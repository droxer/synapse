# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
make dev              # Start backend (port 8000) + web (port 3000) concurrently
make backend          # Backend only: cd backend && uv run python -m api.main
make web              # Frontend only: cd web && npm run dev
make install          # Install all deps (backend + web)
make install-backend  # cd backend && uv sync
make install-web      # cd web && npm install
make build-web        # cd web && npm run build
make build-sandbox    # Build Boxlite sandbox Docker images
make pre-commit       # Install pre-commit hooks
make pre-commit-all   # Run pre-commit on all files
make lint-web         # Lint frontend: cd web && npx eslint src/
make desktop          # Start Tauri desktop app in dev mode
make build-desktop    # Build Tauri desktop app (.app bundle)
```

**Backend testing/linting** (run from `backend/`):
```bash
uv run pytest                          # Run all tests
uv run pytest path/to/test.py::test_fn # IMPORTANT: Run single test function
uv run pytest --cov                    # With coverage
uv run ruff check .                    # Lint
uv run ruff format .                   # Format
```

**Agent evals** (run from project root):
```bash
make evals                                              # Run all evals (mock backend)
make evals EVAL_ARGS="--backend live"                   # Run against real Claude API
make evals EVAL_ARGS="--case web_search_basic"          # Run single case by id
make evals EVAL_ARGS="--tags agent"                     # Filter by tags
make evals EVAL_ARGS="--output report.json"             # Write JSON report
```

**Database migrations** (run from `backend/`):
```bash
uv run alembic upgrade head                          # Apply migrations
uv run alembic revision --autogenerate -m "description"  # Create migration
```

## Code Style & Conventions

**Python (Backend)**
- **Imports**: Standard library first, third-party second, local last. Verify with `ruff check . --fix`.
- **Formatting**: `ruff format` (88-char line limit).
- **Types**: Strict Python 3.12+ type hinting. Use `pydantic` for models/DTOs and `dataclasses(frozen=True)` for internal state to ensure immutability.
- **Naming Conventions**: `snake_case` for files, functions, and variables. `PascalCase` for classes.
- **Error Handling**: Use `try/except`. Raise FastAPI `HTTPException` in API routes. Log errors via `loguru` (`from loguru import logger`).

**TypeScript (Frontend)**
- **Imports**: Group related imports. Prefer absolute aliases (e.g. `@/features/...`, `@/shared/...`).
- **Formatting/Linting**: Handled by `npx eslint src/` with standard Next.js rules.
- **Types**: Strict typing (`tsc --noEmit`). Avoid `any`. Centralize shared types in `src/shared/types/`.
- **Naming Conventions**:
  - **Files**: `PascalCase.tsx` for React components. `kebab-case.ts` for hooks, utils, and APIs.
  - **Entities**: `camelCase` for variables/functions. `PascalCase` for Components, Types, and Interfaces.
- **Error Handling**: Use async/await with `try/catch`. React components should implement loading/error states.

## Architecture

HiAgent is a full-stack AI agent framework: Python/FastAPI backend + TypeScript/Next.js frontend, connected via Server-Sent Events (SSE).

### Backend (`backend/`)
- **`api/main.py`** — FastAPI app factory, initializes shared state (Claude client, sandbox provider, storage, DB)
- **`api/routes/`** — `conversations.py` (SSE streams, planning), `artifacts.py`, `skills.py`, `mcp.py`, `auth.py`, `library.py`, `channels.py` (Telegram webhook, bot config, channel conversations)
- **`api/auth/`** — Authentication middleware (proxy secret verification, rate limiting, NextAuth header extraction)
- **`api/channels/`** — Channel integration: `schemas.py` (frozen DTOs), `repository.py` (DB access), `provider.py` (Telegram provider), `responder.py` (SSE response to channels), `router.py` (link token, account management)
- **`api/builders.py`** — Factory functions for orchestrator and sandbox provider creation
- **`agent/runtime/`** — Core execution components:
  - `orchestrator.py` — Core ReAct loop, immutable state
  - `planner.py` — Task decomposition orchestrator
  - `sub_agent_manager.py` — Multi-agent coordination with concurrent agent spawning, failure propagation (cancel/degrade/replan), per-agent timeouts
  - `task_runner.py` — Focused sub-task executor for spawned agents; emits per-agent metrics (duration, iterations, tool calls, tokens)
  - `skill_selector.py` — Shared LLM-driven skill selector (explicit name → LLM pick → keyword fallback)
  - `observer.py` — Token-aware tiered context compaction with CJK-aware token estimation and layered fallback
- **`agent/tools/`** — Tool abstractions, immutable registry, local & sandbox tools
- **`agent/sandbox/`** — Execution sandbox providers (`boxlite_provider.py`, `e2b_provider.py`, `local_provider.py`)
- **`agent/skills/`** — Skill system mapping `SKILL.md` frontmatter to loadable execution states
- **`agent/memory/`** — Persistent per-conversation memory (`PersistentMemoryStore`)
- **`agent/state/`** — Persistence via SQLAlchemy async engine and Pydantic schemas
- **`evals/`** — Evaluation system parsing YAML test cases (`llm_judge.py`, `grader.py`)

### Frontend (`web/`)
- **Next.js 15** with App Router, React 19, Tailwind CSS 4, Turbopack
- **`src/app/`** — Pages: conversation, skills browser, MCP config, library, channels, login
- **`src/features/conversation/`** — Chat UI, API hooks, auto-reconnecting SSE logic
- **`src/features/agent-computer/`** — Agent execution display (tool output rendering, agent timelines, sub-agent statuses)
- **`src/features/channels/`** — Channel integration:
  - `api/channel-api.ts` — API functions (list conversations, manage Telegram bot config, link tokens)
  - `components/ChannelProviderIcon.tsx` — Provider identity system (Telegram, WhatsApp, Discord, Slack, WeChat SVG icons + badge)
  - `components/ChannelConversationList.tsx` — Split-panel conversation list with provider avatar, last message preview, session indicator
  - `components/ChannelChatView.tsx` — Isolated chat view (SSE, history loading, message merging, no global store)
  - `components/TelegramLinkCard.tsx` — Telegram bot configuration UI
- **`src/shared/stores/app-store.ts`** — Zustand persistent store
- **`next.config.ts`** — Rewrites `/api/*` to `http://localhost:8000/*`

### Desktop (`web/src-tauri/`)
Tauri v2 desktop shell wrapping the web frontend. Uses `sidecar.rs` process manager to start/stop backend Python and frontend Next.js child processes.

### Data Flow

**Chat Flow**
1. User sends message → frontend POSTs to `/api/conversations` (with optional planner mode)
2. Frontend opens SSE connection to `/api/conversations/{id}/events`
3. **If planner mode**: Backend calls `plan_create` → declares steps → spawns agents concurrently → waits for completion
4. **Default mode**: Backend runs ReAct loop: LLM call → tool execution → emit events → repeat
5. Frontend renders events in real-time (messages, timeline, tool outputs, sub-agents)

**Channels Flow**
1. User links Telegram account via bot config endpoint → backend generates webhook secret
2. User sends message via Telegram → bot receives webhook → backend creates conversation/session if needed
3. Backend runs ReAct loop against channel message (same as chat flow)
4. Agent responses emitted as Telegram messages via `ChannelResponder`
5. Frontend displays channel conversations in split-panel UI (left: list, right: chat view)

## Key Patterns
- **Immutability**: Frozen dataclasses throughout backend (`AgentState`, `ToolResult`, `SkillMetadata`, `LLMResponse`, `ChannelConversationRecord`)
- **Event-driven**: `EventEmitter` pub/sub bridges agent loop to SSE stream
- **Tool registry**: Immutable registry pattern — tools registered at startup, looked up by name
- **Skill auto-matching**: LLM-driven selector (explicit name → LLM pick → keyword fallback) chooses best skill; prompt injected into orchestrator
- **Agent naming**: Spawned agents receive friendly names via `spawn_task_agent`
- **Channels isolation**: Channel chat views manage their own SSE connections, history loading, and state independently (no global app store dependency)

## Environment
Required in `backend/.env`: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`.
Optional: `DATABASE_URL` (SQLite default, use PostgreSQL in production), `SANDBOX_PROVIDER` (`boxlite`/`e2b`/`local`), `REDIS_URL`, `STORAGE_PROVIDER` (`local`/`r2`), `SKILLS_ENABLED`, `THINKING_BUDGET`, `LITE_MODEL`, `COMPACT_TOKEN_BUDGET`, `COMPACT_TOKEN_COUNTER` (`weighted`/`legacy`), `COMPACT_FALLBACK_PREVIEW_CHARS`, `COMPACT_FALLBACK_RESULT_CHARS`, `SKILL_SELECTOR_MODEL`, `AGENT_TIMEOUT_SECONDS`, `AUTH_REQUIRED`, `PROXY_SECRET`, `CHANNELS_ENABLED` (enable Telegram channel integration), `CHANNELS_WEBHOOK_BASE_URL` (webhook base URL for channel providers).
Desktop app optional env vars: `HIAGENT_FRONTEND_PORT`, `HIAGENT_BACKEND_PORT`, `HIAGENT_PROJECT_DIR`.
