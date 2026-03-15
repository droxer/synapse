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
```

**Backend testing/linting** (run from `backend/`):
```bash
uv run pytest                          # Run all tests
uv run pytest path/to/test.py::test_fn # Run single test
uv run pytest --cov                    # With coverage
uv run ruff check .                    # Lint
uv run ruff format .                   # Format
```

## Architecture

HiAgent is a full-stack AI agent framework: Python/FastAPI backend + TypeScript/Next.js frontend, connected via Server-Sent Events (SSE).

### Backend (`backend/`)

- **`api/main.py`** — FastAPI app with three endpoints:
  - `POST /tasks` — Create a task
  - `GET /tasks/{task_id}/events` — SSE stream of agent events
  - `POST /tasks/{task_id}/respond` — Submit user responses to agent prompts
- **`agent/loop/orchestrator.py`** — Core ReAct loop (`AgentOrchestrator`). Manages LLM calls, tool execution, and iteration tracking. Uses `AgentState` (frozen dataclass) for immutable state.
- **`agent/loop/planner.py`** — Planning orchestrator for task decomposition
- **`agent/loop/sub_agent_manager.py`** — Multi-agent coordination
- **`agent/llm/client.py`** — Claude API client (anthropic SDK) with tool-use support
- **`agent/tools/`** — Tool system: `base.py` (abstractions), `registry.py` (immutable registry), `executor.py` (execution engine). Tools split into `local/` (web_search, web_fetch, memory, ask_user), `sandbox/` (code execution), `meta/` (agent spawning)
- **`agent/sandbox/`** — Execution sandbox providers (E2B, BoxLite); Dockerfiles in `sandbox/` at repo root
- **`agent/skills/`** — YAML-based skill definitions (web_research, code_project, data_analysis)
- **`config/settings.py`** — Pydantic Settings configuration
- **`api/events.py`** — EventEmitter pub/sub for real-time updates

### Frontend (`web/`)

- **Next.js 15** with App Router, React 19, Tailwind CSS 4, Turbopack
- **`src/components/`** — UI: `Layout.tsx` (60/40 split: chat + reasoning/terminal), `ChatPanel.tsx`, `ReasoningPanel.tsx`, `TerminalViewer.tsx`, `StepTimeline.tsx`, `AgentDashboard.tsx`
- **`src/hooks/useSSE.ts`** — SSE hook consuming `/api/tasks/{taskId}/events`
- **`src/hooks/useAgentState.ts`** — Derives agent state from SSE events
- **`src/stores/appStore.ts`** — Zustand store for app state
- **`src/types/events.ts`** — Shared event type definitions
- **`next.config.ts`** — Rewrites `/api/*` to `http://localhost:8000/*` (backend proxy)

### Data Flow

1. User sends message → frontend POSTs to `/api/tasks`
2. Frontend opens SSE connection to `/api/tasks/{taskId}/events`
3. Backend runs ReAct loop: LLM call → tool execution → emit events → repeat
4. Frontend renders events in real-time across chat, reasoning, and terminal panels

## Environment

Required in `backend/.env` (see `.env.example`):
- `ANTHROPIC_API_KEY` — Required
- `TAVILY_API_KEY` — Required
- `REDIS_URL` — Optional, for state persistence

Python 3.12+, Node.js with npm, `uv` package manager for backend.

## Key Patterns

- **Immutability**: Frozen dataclasses throughout backend (`AgentState`, `ToolResult`, `ToolDefinition`, `SandboxConfig`)
- **Event-driven**: `EventEmitter` pub/sub bridges agent loop to SSE stream
- **Tool registry**: Immutable registry pattern — tools registered at startup, looked up by name at execution
