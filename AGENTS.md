# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

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
```

**Backend testing/linting** (run from `backend/`):
```bash
uv run pytest                          # Run all tests
uv run pytest path/to/test.py::test_fn # Run single test
uv run pytest --cov                    # With coverage
uv run ruff check .                    # Lint
uv run ruff format .                   # Format
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
- **`api/routes/mcp.py`** — MCP server connection management
- **`api/builders.py`** — Factory functions for orchestrator and sandbox provider creation
- **`api/events.py`** — EventEmitter pub/sub for real-time updates
- **`api/dependencies.py`** — FastAPI dependency injection (`AppState` container)
- **`agent/runtime/orchestrator.py`** — Core ReAct loop (`AgentOrchestrator`). Manages LLM calls, tool execution, and iteration tracking. Uses `AgentState` (frozen dataclass) for immutable state.
- **`agent/runtime/planner.py`** — Planning orchestrator (`PlannerOrchestrator`) for task decomposition into sub-tasks
- **`agent/runtime/sub_agent_manager.py`** — Multi-agent coordination with concurrent agent spawning, dependency tracking, and message bus
- **`agent/runtime/task_runner.py`** — Focused sub-task executor (`TaskAgentRunner`) for spawned agents
- **`agent/runtime/helpers.py`** — State processing: `apply_response_to_state`, `process_tool_calls`, `extract_final_text`
- **`agent/runtime/observer.py`** — Context compaction for long conversations
- **`agent/llm/client.py`** — Claude API client (anthropic SDK) with tool-use support, retry logic, extended thinking
- **`agent/tools/`** — Tool system: `base.py` (abstractions), `registry.py` (immutable registry), `executor.py` (execution engine). Tools split into:
  - `local/` — web_search, web_fetch, memory, ask_user, message_user, image_gen, activate_skill, task_complete
  - `sandbox/` — code_interpret, code_run, browser, computer_use, file_ops, database, doc_gen, preview, shell_exec, package_install
  - `meta/` — spawn_task_agent, wait_for_agents, send_message
- **`agent/sandbox/`** — Execution sandbox providers: `boxlite_provider.py` (primary, micro-VMs), `e2b_provider.py` (cloud), `local_provider.py` (dev)
- **`agent/skills/`** — Skill system: `discovery.py` (finds skills), `loader.py` (immutable registry + matching), `parser.py` (SKILL.md frontmatter), `installer.py` (GitHub cloning), `registry_client.py` (external registry API), `models.py` (SkillMetadata, SkillContent, SkillCatalogEntry)
- **`agent/memory/`** — Persistent per-conversation memory (`PersistentMemoryStore` + `MemoryEntry` SQLAlchemy model)
- **`agent/state/`** — Conversation persistence: `database.py` (SQLAlchemy async engine), `models.py` (ConversationModel, MessageModel, EventModel, ArtifactModel, AgentRunModel), `repository.py` (data access), `schemas.py` (Pydantic DTOs)
- **`agent/artifacts/`** — Sandbox artifact extraction (`ArtifactManager`) and storage (`StorageBackend` with local/R2)
- **`agent/mcp/`** — Model Context Protocol: `client.py` (stdio-based MCP communication), `bridge.py` (tool registration), `config.py` (server configuration)
- **`config/settings.py`** — Pydantic Settings configuration (immutable after load)
- **`migrations/`** — Alembic database migration scripts

### Frontend (`web/`)

- **Next.js 15** with App Router, React 19, Tailwind CSS 4, Turbopack
- **`src/app/`** — Pages: conversation (main), skills browser, MCP configuration
- **`src/features/conversation/`** — Chat interface: `ConversationView.tsx` (welcome vs workspace toggle), `ConversationWorkspace.tsx` (60/40 split layout), `ChatInput.tsx` (message input with file upload + skill selector), `WelcomeScreen.tsx` (initial task input), `PendingAskOverlay.tsx` (user input modal)
- **`src/features/conversation/api/conversation-api.ts`** — API layer: createConversation, sendFollowUpMessage, cancelTurn, respondToAskUser
- **`src/features/conversation/hooks/use-conversation.ts`** — Conversation lifecycle and SSE event processing
- **`src/features/agent-computer/`** — Agent execution display: `AgentComputerPanel.tsx`, `AgentProgressCard.tsx` (step timeline), `ToolOutputRenderer.tsx` (code/HTML/image/table rendering), `AgentStatusRow.tsx`, `SkillActivityEntry.tsx`, `ArtifactFilesPanel.tsx`
- **`src/features/agent-computer/hooks/use-agent-state.ts`** — Derives agent state from SSE events (messages, tool calls, agent statuses, artifacts, thinking)
- **`src/features/skills/`** — Skills browser: `SkillsPage.tsx`, `SkillSelector.tsx`, `SkillCard.tsx`
- **`src/features/mcp/`** — MCP configuration: `MCPPage.tsx`, `MCPDialog.tsx`, `TransportToggle.tsx`
- **`src/shared/hooks/use-sse.ts`** — SSE hook with auto-reconnect consuming `/api/conversations/{id}/events`
- **`src/shared/stores/app-store.ts`** — Zustand persistent store for conversation history and app state
- **`src/shared/types/events.ts`** — AgentEvent, EventType, TaskState type definitions
- **`src/shared/components/`** — Sidebar, TopBar, CommandPalette (Cmd+K), MarkdownRenderer, and Radix UI component library
- **`src/i18n/`** — Internationalization with English and Chinese Simplified locales
- **`next.config.ts`** — Rewrites `/api/*` to `http://localhost:8000/*` (backend proxy)

### Data Flow

1. User sends message → frontend POSTs to `/api/conversations`
2. Frontend opens SSE connection to `/api/conversations/{id}/events`
3. Backend runs ReAct loop: LLM call → tool execution → emit events → repeat
4. Frontend renders events in real-time across chat and agent progress panels
5. Artifacts generated in sandbox are extracted and available for download

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

Python 3.12+, Node.js with npm, `uv` package manager for backend.

## Key Patterns

- **Immutability**: Frozen dataclasses throughout backend (`AgentState`, `ToolResult`, `ToolDefinition`, `SandboxConfig`, `SkillMetadata`, `LLMResponse`, `AgentEvent`)
- **Event-driven**: `EventEmitter` pub/sub bridges agent loop to SSE stream; supports multiple subscribers (SSE, database, logging)
- **Tool registry**: Immutable registry pattern — tools registered at startup, looked up by name at execution; `register()` and `merge()` return new instances
- **Repository pattern**: `ConversationRepository` abstracts data access; public APIs return frozen DTOs
- **Factory functions**: `api/builders.py` creates orchestrators and sandbox providers for dependency injection
- **Skill auto-matching**: User messages matched against skill descriptions by keyword overlap; best match injected into system prompt
