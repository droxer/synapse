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
make test             # Run backend tests: cd backend && uv run pytest
make lint             # Lint backend: cd backend && uv run ruff check .
make format           # Format backend: cd backend && uv run ruff format .
make evals            # Run agent evals (mock backend by default)
make pre-commit       # Install pre-commit hooks
make pre-commit-all   # Run pre-commit on all files
make lint-web         # Lint frontend: cd web && npx eslint src/
make desktop          # Start Tauri desktop app in dev mode
make build-desktop    # Build Tauri desktop app (.app bundle)
```

**Backend testing/linting** (run from `backend/`):
```bash
uv run pytest                          # Run all tests
uv run pytest path/to/test.py::test_fn # Run single test
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

## Architecture

HiAgent is a full-stack AI agent framework: Python/FastAPI backend + TypeScript/Next.js frontend, connected via Server-Sent Events (SSE).

### Backend (`backend/`)

- **`api/main.py`** — FastAPI app factory, initializes shared state (Claude client, sandbox provider, storage, DB)
- **`api/routes/conversations.py`** — Conversation endpoints:
  - `POST /conversations` — Create conversation (with optional files, skills, planner mode)
  - `POST /conversations/{id}/messages` — Send follow-up message
  - `GET /conversations/{id}/events` — SSE stream of agent events
  - `POST /conversations/{id}/cancel` — Cancel the current turn
  - `POST /conversations/{id}/respond` — Submit user responses to agent prompts
- **`api/routes/artifacts.py`** — Artifact download and preview endpoints
- **`api/routes/skills.py`** — Skill listing, installation, and management
- **`api/routes/skill_files.py`** — Skill file browsing: directory tree and file content endpoints
- **`api/routes/mcp.py`** — MCP server connection management
- **`api/routes/auth.py`** — Authentication endpoints: user sync on Google OAuth login, profile retrieval, and preference updates (theme, locale)
- **`api/routes/library.py`** — Library endpoint: artifacts grouped by conversation for browsing
- **`api/auth/`** — Authentication middleware: `middleware.py` (proxy secret verification, rate limiting, NextAuth header extraction for `AuthUser`)
- **`api/builders.py`** — Factory functions for orchestrator and sandbox provider creation
- **`api/events.py`** — EventEmitter pub/sub for real-time updates
- **`api/dependencies.py`** — FastAPI dependency injection (`AppState` container)
- **`agent/runtime/orchestrator.py`** — Core ReAct loop (`AgentOrchestrator`). Manages LLM calls, tool execution, and iteration tracking. Uses `AgentState` (frozen dataclass) for immutable state.
- **`agent/runtime/planner.py`** — Planning orchestrator (`PlannerOrchestrator`) for task decomposition into sub-tasks. Calls `plan_create` then spawns agents with dependency tracking
- **`agent/runtime/sub_agent_manager.py`** — Multi-agent coordination with concurrent agent spawning, dependency tracking, and message bus
- **`agent/runtime/task_runner.py`** — Focused sub-task executor (`TaskAgentRunner`) for spawned agents
- **`agent/runtime/helpers.py`** — State processing: `apply_response_to_state`, `process_tool_calls`, `extract_final_text`
- **`agent/runtime/observer.py`** — Context compaction for long conversations
- **`agent/llm/client.py`** — Claude API client (anthropic SDK) with tool-use support, retry logic, extended thinking
- **`agent/tools/`** — Tool system: `base.py` (abstractions), `registry.py` (immutable registry), `executor.py` (execution engine). Tools split into:
  - `local/` — web_search, web_fetch, memory, ask_user, message_user, image_gen, activate_skill, task_complete
  - `sandbox/` — code_interpret, code_run, browser (with step tracking), computer_use (with action metadata), file_ops, database, doc_gen, preview, shell_exec, package_install
  - `meta/` — plan_create (declare plan before spawning), spawn_task_agent (with agent names), wait_for_agents, send_message
- **`agent/sandbox/`** — Execution sandbox providers: `boxlite_provider.py` (primary, micro-VMs), `e2b_provider.py` (cloud), `local_provider.py` (dev)
- **`agent/skills/`** — Skill system: `discovery.py` (finds skills), `loader.py` (immutable registry + matching), `parser.py` (SKILL.md frontmatter), `installer.py` (GitHub cloning), `registry_client.py` (external registry API), `models.py` (SkillMetadata, SkillContent, SkillCatalogEntry)
- **`agent/memory/`** — Persistent per-conversation memory (`PersistentMemoryStore` + `MemoryEntry` SQLAlchemy model)
- **`agent/state/`** — Conversation persistence: `database.py` (SQLAlchemy async engine), `models.py` (ConversationModel, MessageModel, EventModel, ArtifactModel, AgentRunModel, UserModel), `repository.py` (data access), `schemas.py` (Pydantic DTOs)
- **`agent/artifacts/`** — Sandbox artifact extraction (`ArtifactManager`) and storage (`StorageBackend` with local/R2)
- **`agent/mcp/`** — Model Context Protocol: `client.py` (stdio-based MCP communication), `bridge.py` (tool registration), `config.py` (server configuration)
- **`config/settings.py`** — Pydantic Settings configuration (immutable after load)
- **`migrations/`** — Alembic database migration scripts
- **`evals/`** — Agent evaluation system: `models.py` (frozen dataclasses), `loader.py` (YAML case parsing), `collector.py` (EventEmitter subscriber), `runner.py` (orchestrator wiring), `grader.py` (programmatic grading), `llm_judge.py` (LLM-as-judge), `reporter.py` (console/JSON output), `mock_client.py` (scripted LLM), `cases/` (YAML eval definitions)

### Frontend (`web/`)

- **Next.js 15** with App Router, React 19, Tailwind CSS 4, Turbopack
- **`src/app/`** — Pages: conversation (main), skills browser, MCP configuration, library (artifact browser), login (Google OAuth)
- **`src/features/conversation/`** — Chat interface: `ConversationView.tsx` (welcome vs workspace toggle), `ConversationWorkspace.tsx` (60/40 split layout), `ChatInput.tsx` (message input with file upload + skill selector), `WelcomeScreen.tsx` (initial task input), `PendingAskOverlay.tsx` (user input modal)
- **`src/features/conversation/api/conversation-api.ts`** — API layer: createConversation, sendFollowUpMessage, cancelTurn, respondToAskUser
- **`src/features/conversation/hooks/use-conversation.ts`** — Conversation lifecycle and SSE event processing
- **`src/features/agent-computer/`** — Agent execution display: `AgentComputerPanel.tsx`, `AgentProgressCard.tsx` (step timeline with plan mode), `ToolOutputRenderer.tsx` (code/HTML/image/table/browser/computer-use rendering), `AgentStatusRow.tsx`, `SkillActivityEntry.tsx`, `ArtifactFilesPanel.tsx`, `PlanChecklistPanel.tsx` (plan step tracker)
- **`src/features/agent-computer/hooks/use-agent-state.ts`** — Derives agent state from SSE events (messages, tool calls, agent statuses, plan steps, artifacts, thinking)
- **`src/features/agent-computer/lib/tool-constants.ts`** — Tool display names, categories, and normalization (normalizeToolNameI18n, normalizeAgentName, getToolCategory)
- **`src/features/skills/`** — Skills browser: `SkillsPage.tsx`, `SkillSelector.tsx`, `SkillCard.tsx`
- **`src/features/mcp/`** — MCP configuration: `MCPPage.tsx`, `MCPDialog.tsx`, `TransportToggle.tsx`
- **`src/features/library/`** — Artifact library: `LibraryPage.tsx` (grouped by conversation), `LibraryArtifactCard.tsx`, `ConversationGroup.tsx`, `ViewModeToggle.tsx`
- **`src/shared/hooks/use-sse.ts`** — SSE hook with auto-reconnect consuming `/api/conversations/{id}/events`
- **`src/shared/stores/app-store.ts`** — Zustand persistent store for conversation history and app state
- **`src/shared/types/events.ts`** — AgentEvent, EventType, TaskState type definitions
- **`src/shared/components/`** — Sidebar, TopBar, CommandPalette (Cmd+K), MarkdownRenderer, and Radix UI component library
- **`src/i18n/`** — Internationalization with English and Chinese Simplified locales
- **`next.config.ts`** — Rewrites `/api/*` to `http://localhost:8000/*` (backend proxy)

### Desktop (`web/src-tauri/`)

Tauri v2 desktop shell wrapping the web frontend. See [docs/desktop-app.md](docs/desktop-app.md) for full details.

- **`src/main.rs`** — Entry point
- **`src/lib.rs`** — Tauri setup, plugin registration (shell, deep-link), custom commands (`open_url`, `get_frontend_url`, `get_sidecar_status`)
- **`src/config.rs`** — Env-based configuration (`HIAGENT_FRONTEND_PORT`, `HIAGENT_BACKEND_PORT`, `HIAGENT_PROJECT_DIR`)
- **`src/sidecar.rs`** — Process manager: starts/stops backend (Python) and frontend (Next.js) as child processes with health checks
- **`tauri.conf.json`** — Window config, CSP, bundle targets, deep-link scheme (`hiagent://`)
- **`capabilities/default.json`** — ACL permissions for shell, deep-link, devtools
- **Desktop OAuth** — System browser OAuth flow via nonce-based token exchange:
  - `src/lib/tauri.ts` — `isTauri()` detection (3-layer: `__TAURI_INTERNALS__`, URL param, localStorage)
  - `src/app/api/auth/desktop-token/route.ts` — In-memory token exchange API
  - `src/app/auth/desktop-callback/page.tsx` — Browser-side callback that posts user data
  - `src/lib/auth.ts` — `desktop-token` Credentials provider for webview session creation

### Data Flow

1. User sends message → frontend POSTs to `/api/conversations` (with optional planner mode)
2. Frontend opens SSE connection to `/api/conversations/{id}/events`
3. **If planner mode**: Backend calls `plan_create` → declares plan steps → spawns agents concurrently → waits for completion
4. **Default mode**: Backend runs ReAct loop: LLM call → tool execution → emit events → repeat
5. Frontend renders events in real-time:
   - Chat messages and thinking
   - Agent progress timeline (with plan steps if enabled)
   - Tool outputs (code, HTML, browser steps, computer actions)
   - Sub-agent statuses with names
   - Plan checklist with completion status
6. Artifacts generated in sandbox are extracted and available for download

## Environment

Required in `backend/.env` (see `.env.example`):
- `ANTHROPIC_API_KEY` — Required
- `TAVILY_API_KEY` — Required
- `DATABASE_URL` — Optional, PostgreSQL connection string (default: SQLite fallback)
- `SANDBOX_PROVIDER` — Optional, `boxlite` (default), `e2b`, or `local`
- `REDIS_URL` — Optional, for caching
- `STORAGE_PROVIDER` — Optional, `local` (default) or `r2` for artifact storage
- `SKILLS_ENABLED` — Optional, enable skill system (default: `true`)
- `THINKING_BUDGET` — Optional, extended thinking token budget (default: `10000`, `0` = disabled)
- `LITE_MODEL` — Optional, model for simple/quick sub-tasks (default: `claude-haiku-4-5-20251001`)
- `AUTH_REQUIRED` — Optional, require Google authentication (default: `false`)
- `PROXY_SECRET` — Optional, shared secret between Next.js proxy and backend (required in production)
- `ENVIRONMENT` — Optional, `development` (default) or `production`

Desktop app env vars (optional, for `make desktop` / `make build-desktop`):
- `HIAGENT_FRONTEND_PORT` — Optional, Next.js port (default: `3000`)
- `HIAGENT_BACKEND_PORT` — Optional, FastAPI port (default: `8000`)
- `HIAGENT_PROJECT_DIR` — Optional, HiAgent repo root (default: auto-detected)

Python 3.12+, Node.js with npm, `uv` package manager for backend. Rust 1.77+ for desktop app.

## Key Patterns

- **Immutability**: Frozen dataclasses throughout backend (`AgentState`, `ToolResult`, `ToolDefinition`, `SandboxConfig`, `SkillMetadata`, `LLMResponse`, `AgentEvent`, `EvalCase`, `EvalResult`, `EvalMetrics`)
- **Event-driven**: `EventEmitter` pub/sub bridges agent loop to SSE stream; supports multiple subscribers (SSE, database, logging). New `plan_created` event emitted when plan mode creates steps.
- **Tool registry**: Immutable registry pattern — tools registered at startup, looked up by name at execution; `register()` and `merge()` return new instances. Planner mode auto-registers `plan_create` and `spawn_task_agent` with agent name tracking.
- **Repository pattern**: `ConversationRepository` abstracts data access; public APIs return frozen DTOs
- **Factory functions**: `api/builders.py` creates orchestrators and sandbox providers for dependency injection
- **Skill auto-matching**: User messages matched against skill descriptions by keyword overlap; best match injected into system prompt
- **Agent naming**: Spawned agents receive user-friendly names passed via `spawn_task_agent` (required in plan mode, optional in default mode). Normalized via `normalizeAgentName` in frontend.
