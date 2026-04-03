# Development Guide

**English** | [简体中文](zh-CN/development.md) · [Documentation index](README.md) · [AGENTS.md](../AGENTS.md)

## Commands

```bash
make dev              # Start backend (port 8000) + frontend (port 3000) concurrently
make backend          # Backend only: cd backend && uv run python -m api.main
make web              # Frontend only: cd web && npm run dev
make install          # Install all deps (backend + web)
make install-backend  # cd backend && uv sync
make install-web      # cd web && npm install
make build-web        # cd web && npm run build
make build-sandbox    # Build Boxlite sandbox Docker images
make clean            # Remove .venv, node_modules, .next
make pre-commit       # Install pre-commit hooks
make pre-commit-all   # Run pre-commit on all files
make lint-web         # Lint frontend: cd web && npx eslint src/
make desktop          # Start Tauri desktop app in dev mode
make build-desktop    # Build Tauri desktop app (.app bundle)
```

### Backend Testing & Linting

Run from `backend/`:

```bash
uv run pytest                          # Run all tests
uv run pytest path/to/test.py::test_fn # IMPORTANT: Run single test function
uv run pytest --cov                    # With coverage
uv run ruff check .                    # Lint
uv run ruff format .                   # Format
```

### Agent Evals

Run from the project root:

```bash
make evals                                              # Run all evals (mock backend)
make evals EVAL_ARGS="--backend live"                   # Run against real Claude API
make evals EVAL_ARGS="--case web_search_basic"          # Run single case by id
make evals EVAL_ARGS="--tags agent"                     # Filter by tags (agent, skill, handoff, etc.)
make evals EVAL_ARGS="--output report.json"             # Write JSON report
make evals EVAL_ARGS="--judge-model claude-sonnet-4-20250514"  # Custom LLM judge model
```

Or run directly via uv:

```bash
cd backend && uv run python -m evals --help
```

### Database Migrations

Run from `backend/`:

```bash
uv run alembic upgrade head                              # Apply migrations
uv run alembic revision --autogenerate -m "description"  # Create migration
```

---

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

---

## Architecture

```
HiAgent/
├── backend/
│   ├── api/                  # FastAPI application
│   │   ├── main.py           # App factory, startup, shared state init
│   │   ├── routes/           # Endpoint handlers
│   │   │   ├── conversations.py  # Conversation CRUD + SSE streaming
│   │   │   ├── artifacts.py      # Artifact download & preview
│   │   │   ├── skills.py         # Skill discovery, install, uninstall
│   │   │   ├── skill_files.py    # Skill file browsing (directory tree + file content)
│   │   │   ├── mcp.py            # MCP server management
│   │   │   ├── auth.py           # Auth endpoints (user sync, profile, preferences)
│   │   │   ├── library.py        # Library (artifacts grouped by conversation)
│   │   │   └── channels.py       # Telegram channel integration, webhook ingress
│   │   ├── channels/          # Channel integration module
│   │   │   ├── __init__.py
│   │   │   ├── schemas.py     # Frozen DTOs (ChannelConversationRecord, ChannelSessionRecord, etc.)
│   │   │   ├── repository.py  # Data access for channel accounts, sessions, conversations
│   │   │   ├── provider.py    # ChannelProvider protocol, TelegramProvider implementation
│   │   │   ├── responder.py   # ChannelResponder — subscribes to events, sends to Telegram
│   │   │   └── router.py      # ChannelRouter — handles inbound messages, link tokens
│   │   ├── auth/              # Authentication middleware
│   │   │   ├── __init__.py
│   │   │   └── middleware.py  # Proxy secret verification, rate limiting, NextAuth headers
│   │   ├── builders.py       # Factory functions (orchestrator, sandbox provider)
│   │   ├── dependencies.py   # FastAPI dependency injection (AppState)
│   │   ├── events.py         # EventEmitter pub/sub system
│   │   ├── models.py         # Request/response Pydantic models
│   │   ├── sse.py            # SSE streaming utilities
│   │   └── db_subscriber.py  # Persists events to database
│   ├── agent/
│   │   ├── runtime/          # Agent orchestration engine
│   │   │   ├── orchestrator.py       # AgentOrchestrator — single-agent ReAct loop
│   │   │   ├── planner.py           # PlannerOrchestrator — task decomposition
│   │   │   ├── sub_agent_manager.py # SubAgentManager — concurrent agent coordination
│   │   │   ├── task_runner.py       # TaskAgentRunner — focused sub-task execution
│   │   │   ├── skill_selector.py    # Shared LLM-driven skill selector (explicit > model > keyword)
│   │   │   ├── helpers.py           # apply_response_to_state, process_tool_calls
│   │   │   └── observer.py          # Token-aware tiered context compaction
│   │   ├── llm/
│   │   │   └── client.py    # ClaudeClient — async Anthropic SDK wrapper
│   │   ├── tools/
│   │   │   ├── base.py      # LocalTool, SandboxTool abstractions
│   │   │   ├── registry.py  # ToolRegistry — immutable tool collection
│   │   │   ├── executor.py  # ToolExecutor — routes local vs sandbox execution
│   │   │   ├── local/       # Host-side tools
│   │   │   │   ├── activate_skill.py   # Load skill system prompt
│   │   │   │   ├── ask_user.py         # Prompt user for input
│   │   │   │   ├── message_user.py     # Send text to user
│   │   │   │   ├── web_search.py       # Tavily web search
│   │   │   │   ├── web_fetch.py        # Fetch web content
│   │   │   │   ├── image_gen.py        # MiniMax image generation
│   │   │   │   ├── memory_store.py     # Persist key-value memory
│   │   │   │   ├── memory_recall.py    # Retrieve memory
│   │   │   │   ├── memory_list.py      # List memory keys
│   │   │   │   └── task_complete.py    # Mark task done + emit summary
│   │   │   ├── sandbox/     # Sandboxed execution tools
│   │   │   │   ├── code_interpret.py   # Python code execution
│   │   │   │   ├── code_run.py         # Shell command execution
│   │   │   │   ├── shell_exec.py       # Shell script execution
│   │   │   │   ├── browser.py          # Playwright browser automation
│   │   │   │   ├── computer_use.py     # Vision + mouse/keyboard control
│   │   │   │   ├── file_ops.py         # File read/write/delete
│   │   │   │   ├── code_search.py      # File search in sandbox
│   │   │   │   ├── database.py         # SQL query execution
│   │   │   │   ├── doc_gen.py          # Document generation
│   │   │   │   ├── doc_read.py         # Read documentation files
│   │   │   │   ├── package_install.py  # pip/npm package installation
│   │   │   │   └── preview.py          # HTML/image preview
│   │   │   └── meta/        # Agent coordination tools
│   │   │       ├── plan_create.py         # Declare plan steps (plan mode)
│   │   │       ├── spawn_task_agent.py    # Spawn sub-agents (with agent names)
│   │   │       ├── wait_for_agents.py     # Wait for sub-agent completion
│   │   │       └── send_message.py        # Agent-to-agent messaging
│   │   ├── sandbox/          # Execution environment providers
│   │   │   ├── base.py              # SandboxProvider/Session protocols, types
│   │   │   ├── boxlite_provider.py  # Boxlite micro-VM backend (primary)
│   │   │   ├── e2b_provider.py      # E2B cloud sandbox
│   │   │   ├── e2b_pool.py          # E2B session pooling
│   │   │   └── local_provider.py    # Local subprocess sandbox (dev/testing)
│   │   ├── skills/           # Skill system
│   │   │   ├── models.py        # SkillMetadata, SkillContent, SkillCatalogEntry
│   │   │   ├── parser.py        # SKILL.md frontmatter parsing
│   │   │   ├── discovery.py     # SkillDiscoverer — finds skills in directories
│   │   │   ├── loader.py        # SkillRegistry — immutable collection + matching
│   │   │   ├── installer.py     # SkillInstaller — clones from GitHub
│   │   │   └── registry_client.py  # External skill registry API client
│   │   ├── memory/           # Persistent agent memory
│   │   │   ├── models.py    # MemoryEntry SQLAlchemy model
│   │   │   └── store.py     # PersistentMemoryStore (per-conversation)
│   │   ├── state/            # Conversation persistence
│   │   │   ├── database.py      # SQLAlchemy async engine/session factory
│   │   │   ├── models.py        # ORM models (Conversation, Message, Event, Artifact, AgentRun, User)
│   │   │   ├── repository.py    # ConversationRepository — data access
│   │   │   └── schemas.py       # Pydantic DTOs for public APIs
│   │   ├── artifacts/        # Artifact management
│   │   │   ├── manager.py   # ArtifactManager — downloads/tracks sandbox files
│   │   │   └── storage.py   # StorageBackend abstraction (local/R2)
│   │   ├── mcp/              # Model Context Protocol
│   │   │   ├── client.py    # MCPStdioClient — stdio-based communication
│   │   │   ├── bridge.py    # MCP bridge for tool registration
│   │   │   └── config.py    # MCP server configuration
│   │   └── logging.py       # Loguru setup
│   ├── config/
│   │   └── settings.py      # Pydantic Settings (immutable after load)
│   ├── evals/                # Agent evaluation system
│   │   ├── models.py         # Frozen dataclasses (EvalCase, EvalResult, EvalMetrics, etc.)
│   │   ├── loader.py         # YAML eval case parsing + validation
│   │   ├── collector.py      # EventEmitter subscriber — captures tool calls, tokens, errors
│   │   ├── runner.py         # EvalRunner — wires orchestrator, runs cases, collects results
│   │   ├── grader.py         # Programmatic grading (tool_used, skill_activated, agent_spawned, etc.)
│   │   ├── llm_judge.py      # LLM-as-judge grading via Claude API
│   │   ├── reporter.py       # Console + JSON report output
│   │   ├── mock_client.py    # ScriptedLLMClient for deterministic/fast evals
│   │   ├── __main__.py       # CLI: uv run python -m evals
│   │   └── cases/            # YAML eval case definitions
│   ├── migrations/           # Alembic migration scripts
│   └── tests/                # 50+ test files
├── web/
│   ├── src/
│   │   ├── app/              # Next.js App Router
│   │   │   └── (main)/      # Main layout group
│   │   │       ├── page.tsx          # Conversation page
│   │   │       ├── channels/page.tsx # Channel conversations (split-panel: list + chat)
│   │   │       ├── skills/page.tsx   # Skills browser
│   │   │       ├── mcp/page.tsx      # MCP configuration
│   │   │       └── library/page.tsx  # Artifact library
│   │   │   └── login/page.tsx        # Google OAuth login
│   │   ├── features/
│   │   │   ├── conversation/         # Chat interface
│   │   │   │   ├── api/              # conversation-api.ts, history-api.ts
│   │   │   │   ├── components/       # ConversationView, ChatInput, WelcomeScreen, etc.
│   │   │   │   └── hooks/            # use-conversation, use-pending-ask
│   │   │   ├── agent-computer/       # Agent execution display
│   │   │   │   ├── components/       # AgentComputerPanel, AgentProgressCard, ToolOutputRenderer, PlanChecklistPanel
│   │   │   │   ├── hooks/            # use-agent-state
│   │   │   │   └── lib/              # tool-constants (tool display names, agent name normalization)
│   │   │   ├── channels/             # Channel integration (Telegram, future: WhatsApp, Discord, etc.)
│   │   │   │   ├── api/              # channel-api.ts (list conversations, bot config, link tokens)
│   │   │   │   ├── components/       # ChannelProviderIcon, ChannelConversationList, ChannelChatView, TelegramLinkCard
│   │   │   │   └── lib/              # Provider color/label utilities
│   │   │   ├── skills/               # Skills browser & selector
│   │   │   │   ├── api/              # skills-api.ts
│   │   │   │   ├── components/       # SkillsPage, SkillSelector, SkillCard
│   │   │   │   └── hooks/            # use-skills-cache
│   │   │   ├── mcp/                  # MCP configuration
│   │   │   │   ├── api/              # mcp-api.ts
│   │   │   │   └── components/       # MCPPage, MCPDialog, TransportToggle
│   │   │   └── library/              # Artifact library
│   │   │       ├── api/              # library-api.ts
│   │   │       ├── components/       # LibraryPage, LibraryArtifactCard, ConversationGroup
│   │   │       └── hooks/            # use-library, use-view-mode
│   │   ├── shared/
│   │   │   ├── components/           # Sidebar, TopBar, CommandPalette, MarkdownRenderer
│   │   │   │   └── ui/              # Radix UI component library (30+ components)
│   │   │   ├── hooks/               # use-sse, use-media-query
│   │   │   ├── stores/              # app-store (Zustand)
│   │   │   ├── types/               # events.ts (AgentEvent, EventType, TaskState)
│   │   │   └── lib/                 # utils, a11y
│   │   └── i18n/                    # Internationalization (en, zh-CN)
│   ├── next.config.ts               # API proxy to backend
│   ├── tailwind.config.ts
│   └── package.json
├── container/                # Sandbox Docker images (multi-stage, optimized)
│   ├── Dockerfile.base           # Base image: Python 3.12, system packages, shared Python deps
│   ├── Dockerfile.default        # Standard tools: Node.js, Python dev, git (extends base)
│   ├── Dockerfile.data_science   # ML tools: pandas, numpy, matplotlib (extends base)
│   ├── Dockerfile.browser        # Playwright + browser automation (extends base)
│   └── doc_templates/            # Document generation templates
├── docs/                     # Documentation
└── Makefile
```

---

## Data Flow

```
User message
  │
  ▼
POST /conversations ──────────────────► Backend creates conversation
  │                                     Builds orchestrator + event emitter
  │                                     Returns { conversation_id }
  │
  ▼
GET /conversations/{id}/events ───────► SSE stream opens
  │
  ▼
ReAct Loop (backend)
  ├─ LLM request (Claude API)
  │   └─ Emits: llm_request, text_delta, llm_response
  ├─ Tool execution (ToolExecutor)
  │   ├─ Local tools → run in-process
  │   └─ Sandbox tools → run in Boxlite micro-VM
  │   └─ Emits: tool_call, tool_result, sandbox_stdout/stderr
  ├─ Sub-agent spawning (if planner mode)
  │   └─ Emits: agent_spawn, agent_complete
  └─ Repeat until end_turn or max iterations
  │
  ▼
task_complete event ──────────────────► Frontend renders final result
                                         Artifacts available for download
```

---

## API Reference

### Conversations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conversations` | Create conversation. Accepts JSON or FormData (with files). Body: `message`, `files[]`, `skills[]`, `use_planner` |
| `POST` | `/conversations/{id}/messages` | Send follow-up message. Same body format as create |
| `GET` | `/conversations/{id}/events` | SSE stream of `AgentEvent` objects |
| `POST` | `/conversations/{id}/cancel` | Cancel the current agent turn |
| `POST` | `/conversations/{id}/respond` | Submit user response to an `ask_user` prompt. Body: `response` |
| `GET` | `/conversations/{id}/metrics` | Return aggregated metrics: token usage, tool call counts, per-agent metrics |

### Artifacts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/artifacts/{id}` | Download generated artifact file |
| `GET` | `/artifacts/{id}/preview` | Preview artifact (HTML rendered in iframe, images inline) |

### Skills

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skills` | List all available skills (bundled + installed) |
| `GET` | `/skills/{name}` | Get skill details |
| `GET` | `/skills/{name}/files` | List skill directory tree as JSON |
| `GET` | `/skills/{name}/files/{path}` | Get a single file's content as text |
| `POST` | `/skills/install` | Install skill from GitHub URL. Body: `url` |
| `DELETE` | `/skills/{name}` | Uninstall a skill |

### MCP

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mcp/servers` | List connected MCP servers |
| `POST` | `/mcp/servers` | Connect an MCP server. Body: transport config |
| `DELETE` | `/mcp/servers/{name}` | Disconnect an MCP server |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/me` | Upsert user record after Google OAuth login |
| `GET` | `/user/me` | Get current user profile (including preferences) |
| `PATCH` | `/user/me/preferences` | Update theme and/or locale. Body: `theme`, `locale` |

### Library

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/library` | List artifacts grouped by conversation. Query: `limit`, `offset` |

### Channels

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/channels/telegram/webhook` | Telegram bot webhook ingress (verified via X-Telegram-Bot-API-Secret-Token) |
| `POST` | `/channels/telegram/config` | Save/update Telegram bot token and webhook configuration. Body: `bot_token` |
| `DELETE` | `/channels/telegram/config` | Disable Telegram bot and delete webhook |
| `POST` | `/channels/link-token` | Create a one-time link token for account pairing. Body: `provider` |
| `GET` | `/channels/accounts` | List linked channel accounts for current user |
| `DELETE` | `/channels/accounts/{account_id}` | Unlink a channel account |
| `GET` | `/channels/conversations` | List channel conversations with last message preview and session status |
| `GET` | `/channels/status` | Get channel feature status (enabled providers, bot config, account links) |

### SSE Event Types

| Event | Description |
|-------|-------------|
| `task_start` | Conversation started |
| `task_complete` | Agent finished (includes summary) |
| `task_error` | Agent encountered an error |
| `turn_start` / `turn_complete` | Follow-up turn lifecycle |
| `iteration_start` / `iteration_complete` | ReAct loop iteration |
| `llm_request` / `llm_response` | LLM API call |
| `text_delta` | Streaming text chunk from LLM |
| `thinking` | Extended thinking content |
| `tool_call` / `tool_result` | Tool invocation and result |
| `sandbox_stdout` / `sandbox_stderr` | Sandbox console output |
| `code_result` | Code execution result |
| `message_user` | Agent sends text to user |
| `ask_user` / `user_response` | Agent asks for user input |
| `agent_spawn` / `agent_complete` | Sub-agent lifecycle |
| `plan_created` | Plan mode: steps declared before spawning agents |
| `artifact_created` | New artifact available |
| `preview_available` / `preview_stopped` | HTML/image preview lifecycle |
| `conversation_title` | Auto-generated conversation title |

---

## Key Modules

### Runtime Engine (`agent/runtime/`)

The runtime engine implements the ReAct (Reason + Act) loop:

- **`AgentOrchestrator`** — Single-agent loop. Calls LLM, executes tool calls, emits events, repeats until `end_turn` or max iterations (50). Uses `AgentState` (frozen dataclass) for immutable state — every mutation returns a new instance.

- **`PlannerOrchestrator`** — Extends the ReAct loop with task decomposition. Requires agents to call `plan_create` first to declare steps with names and descriptions. Then spawns worker agents via `SubAgentManager`, and coordinates results. Emits `plan_created` event. Planner mode auto-registers `plan_create` and `spawn_task_agent` tools.

- **`SubAgentManager`** — Manages concurrent agents (max 5 concurrent, 20 total). Handles dependency tracking (`depends_on`), per-agent tool registries, and an async message bus for agent-to-agent communication. Tracks agent names for UI display. Enforces per-agent timeouts (`AGENT_TIMEOUT_SECONDS`, default 300s) and propagates failures with configurable policies (cancel remaining agents, degrade gracefully, or replan).

- **`TaskAgentRunner`** — Executes a single sub-task with its own sandbox. Returns `AgentResult` (frozen) with success status, summary, artifacts, and per-agent metrics (duration, iterations, tool call counts, token usage). Metrics are emitted in the `agent_complete` event and aggregated by `GET /conversations/{id}/metrics`.

- **`Observer`** — Token-aware tiered context compaction. Estimates token usage via a weighted heuristic (ASCII chars ÷ 4, non-ASCII chars × 1.5 for CJK accuracy) and triggers compaction when the budget is exceeded (default 150K tokens). Uses a two-tier strategy: the **hot tier** keeps the last N tool interactions verbatim (default 5), while the **warm tier** applies a layered fallback — structured summary via LLM (Haiku) → larger text preview → minimal marker — to older interactions. Emits a `CONTEXT_COMPACTED` event with before/after message counts.

- **`SkillSelector`** — Shared LLM-driven skill selector used by both `AgentOrchestrator` and `TaskAgentRunner`. Implements a three-tier priority: (1) explicit user selection by name, (2) LLM pick from the skill catalog (configurable via `SKILL_SELECTOR_MODEL`), (3) keyword overlap fallback. Replaces the previous keyword-only matching.

### Tool System (`agent/tools/`)

- **`ToolRegistry`** — Immutable collection. `register()` and `merge()` return new instances.
- **`ToolExecutor`** — Routes execution: local tools run in-process, sandbox tools get a lazily-created `SandboxSession` by template.
- **`LocalTool` / `SandboxTool`** — Abstract base classes. Each tool defines `name`, `description`, `input_schema`, and an async `execute()` method.

### Sandbox System (`agent/sandbox/`)

Three providers implementing the `SandboxSession` protocol:

| Provider | Use Case | Isolation |
|----------|----------|-----------|
| **Boxlite** | Production | Hardware-isolated micro-VMs |
| **E2B** | Cloud | Cloud sandboxes with pooling |
| **Local** | Development | Subprocess (no isolation) |

Session interface: `exec()`, `upload_file()`, `download_file()`, `interpret()`, `screenshot()`, `close()`

### Skill System (`agent/skills/`)

Skills are SKILL.md files with YAML frontmatter:

```yaml
---
name: data-analysis
description: Structured data analysis methodology
license: MIT
sandbox_template: data_science
allowed_tools:
  - code_run
  - database
---

## Instructions
...methodology content...
```

- **Discovery** — Scans `~/.hiagent/skills/` (bundled), `./skills/` (project), `./hiagent-skills/` (imported)
- **Matching** — LLM-driven selection from the skill catalog (explicit name → LLM pick → keyword overlap fallback). Configurable model via `SKILL_SELECTOR_MODEL`.
- **Activation** — Best-match skill prompt injected into orchestrator; agent restricted to allowed tools
- **Installation** — Clone from GitHub via `SkillInstaller`

### Agent Evaluation System (`evals/`)

A self-contained evaluation framework that hooks into the existing `EventEmitter` to test agent behavior against defined scenarios, measure quality, and catch regressions.

- **YAML eval cases** — Each case defines a user message, grading criteria, mock LLM responses, and expected behavior. Cases are stored in `evals/cases/`.

- **Grading criteria** — 11 programmatic criterion types:

| Criterion | Checks |
|-----------|--------|
| `tool_used` / `tool_not_used` | Whether a specific tool was (not) called |
| `output_regex` / `output_contains` | Final output matches a pattern or substring |
| `max_iterations` / `tool_call_count` | Execution stayed within limits |
| `no_errors` | No errors occurred during execution |
| `skill_activated` | A specific skill was activated |
| `agent_spawned` | Sub-agents were spawned (by count, task substring, or any) |
| `agent_handoff` | An agent handoff occurred (optionally to a specific role) |
| `context_compaction` | Context compaction was triggered (optionally a minimum count) |

- **LLM-as-judge** — Sends task context, actual output, and tool call sequence to Claude for qualitative scoring. Uses Haiku by default for cost efficiency.

- **Mock mode** — `ScriptedLLMClient` returns pre-defined LLM responses for deterministic, fast, offline evals. `MockToolExecutor` returns success for all tool calls.

- **Live mode** — Runs against real Claude API to test actual agent behavior.

- **EvalCollector** — Subscribes to `EventEmitter` and captures tool calls, token usage, errors, skill activations, agent spawns, and handoffs into frozen `EvalMetrics`.

- **Built-in eval cases** — 11 scenarios covering web search, code execution, multi-tool chaining, skill invocation, sub-agent spawning, agent handoff, and CJK context compaction (5 cases).

### State Persistence (`agent/state/`)

SQLAlchemy async ORM with six models:

| Model | Purpose |
|-------|---------|
| `ConversationModel` | Top-level conversation record |
| `MessageModel` | Individual messages (user/assistant/tool) |
| `EventModel` | Raw event stream for replay |
| `ArtifactModel` | Generated file metadata |
| `AgentRunModel` | Sub-agent execution records |
| `UserModel` | User profile (Google OAuth) with preferences (theme, locale) |

Accessed through `ConversationRepository` (repository pattern). Public APIs return frozen Pydantic DTOs.

---

## Environment Variables

Required in `backend/.env` (see `backend/.env.example`):

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for your LLM provider (Anthropic or any compatible provider) |
| `TAVILY_API_KEY` | Tavily API key for web search |

### LLM Provider

HiAgent works with any LLM provider that exposes an Anthropic-compatible API. Configure via `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`.

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | LLM API base URL — change to use alternative providers (e.g. OpenRouter, Bedrock, or any Anthropic-compatible proxy) |
| `PLANNING_MODEL` | `claude-sonnet-4-20250514` | Model for task planning |
| `TASK_MODEL` | `claude-sonnet-4-20250514` | Model for task execution |
| `LITE_MODEL` | `claude-haiku-4-5-20251001` | Model for simple sub-tasks |
| `THINKING_BUDGET` | `10000` | Extended thinking token budget (`0` = disabled) |
| `COMPACT_TOKEN_BUDGET` | `150000` | Estimated token threshold to trigger context compaction |
| `COMPACT_TOKEN_COUNTER` | `weighted` | Token counting strategy: `weighted` (CJK-aware) or `legacy` (chars÷4) |
| `COMPACT_FULL_INTERACTIONS` | `5` | Recent tool interactions kept verbatim (hot tier) |
| `COMPACT_FALLBACK_PREVIEW_CHARS` | `500` | Char limit for text preview in layered compaction fallback |
| `COMPACT_FALLBACK_RESULT_CHARS` | `1000` | Char limit for result preview in layered compaction fallback |
| `COMPACT_SUMMARY_MODEL` | (uses `LITE_MODEL`) | Model for warm-tier summarisation of older interactions |
| `SKILL_SELECTOR_MODEL` | (uses `LITE_MODEL`) | Model for LLM-driven skill selection (tier 2 of 3) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string (`postgresql+asyncpg://...`) |
| `REDIS_URL` | — | Redis URL for caching |
| `AGENT_TIMEOUT_SECONDS` | `300` | Per-agent execution timeout in seconds |
| `SANDBOX_PROVIDER` | `boxlite` | Sandbox backend: `boxlite` (prebuilt images on GHCR), `e2b`, or `local` |
| `E2B_API_KEY` | — | E2B API key (if using E2B provider) |
| `MINIMAX_API_KEY` | — | MiniMax API key (for image generation) |
| `STORAGE_PROVIDER` | `local` | Artifact storage: `local` or `r2` |
| `STORAGE_DIR` | `./artifacts` | Local artifact storage directory |
| `R2_ACCOUNT_ID` | — | Cloudflare R2 account (if using R2 storage) |
| `R2_ACCESS_KEY_ID` | — | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | — | Cloudflare R2 secret key |
| `R2_BUCKET_NAME` | — | Cloudflare R2 bucket name |
| `SKILLS_ENABLED` | `true` | Enable skill system |
| `SKILLS_REGISTRY_URL` | `https://api.agentskills.io` | External skill registry URL |
| `SKILLS_TRUST_PROJECT` | `true` | Trust project-level skills |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins |
| `API_KEY` | — | API authentication key |
| `RATE_LIMIT_PER_MINUTE` | `30` | Rate limiting threshold (per IP per minute) |
| `AUTH_REQUIRED` | `false` | Require Google authentication for all requests |
| `PROXY_SECRET` | — | Shared secret between Next.js proxy and backend (required in production) |
| `ENVIRONMENT` | `development` | Environment mode: `development` or `production` |
| `CHANNELS_ENABLED` | `false` | Enable Telegram channel integration |
| `CHANNELS_WEBHOOK_BASE_URL` | — | Webhook base URL for channel providers (e.g., `https://your-domain.com`) |
| `MEMORY_FACT_CONFIDENCE_THRESHOLD` | `0.85` | Minimum confidence required before auto-saving extracted facts |
| `MEMORY_FACT_TOP_K` | `8` | Maximum number of active facts injected into each turn |
| `MEMORY_FACT_PROMPT_TOKEN_CAP` | `1200` | Character cap for the verified-facts prompt section |

---

## Key Design Patterns

### Immutability

All core types are frozen dataclasses. Mutation methods return new instances:

```python
@dataclass(frozen=True)
class AgentState:
    messages: tuple[dict, ...]
    iteration: int
    completed: bool

    def add_message(self, msg: dict) -> "AgentState":
        return AgentState(
            messages=self.messages + (msg,),
            iteration=self.iteration,
            completed=self.completed,
        )
```

Applied to: `AgentState`, `ToolResult`, `ToolDefinition`, `SandboxConfig`, `SkillMetadata`, `LLMResponse`, `AgentEvent`, `TokenUsage`, `Artifact`, `EvalCase`, `EvalResult`, `EvalMetrics`, and all result types.

### Event-Driven Architecture

`EventEmitter` (async pub/sub) decouples the agent loop from consumers:

- SSE streaming to frontend
- Database persistence via `db_subscriber`
- Logging

All subscribers notified concurrently per event.

### Immutable Registries

`ToolRegistry` and `SkillRegistry` follow the same pattern — `register()` and `merge()` return new instances, leaving the original unchanged.

### Repository Pattern

`ConversationRepository` abstracts SQLAlchemy internals. Public methods return frozen Pydantic DTOs. Internal ORM models stay private.

### Factory Functions

`api/builders.py` contains factory functions for creating orchestrators and sandbox providers, simplifying testing with mocks and keeping route handlers thin.
