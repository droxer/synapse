**English** | [简体中文](zh-CN/development.md)

# Development Guide

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
```

### Backend Testing & Linting

Run from `backend/`:

```bash
uv run pytest                          # All tests
uv run pytest path/to/test.py::test_fn # Single test
uv run pytest --cov                    # With coverage
uv run ruff check .                    # Lint
uv run ruff format .                   # Format
```

### Database Migrations

Run from `backend/`:

```bash
uv run alembic upgrade head                              # Apply migrations
uv run alembic revision --autogenerate -m "description"  # Create migration
```

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
│   │   │   └── mcp.py            # MCP server management
│   │   ├── builders.py       # Factory functions (orchestrator, sandbox provider)
│   │   ├── dependencies.py   # FastAPI dependency injection (AppState)
│   │   ├── events.py         # EventEmitter pub/sub system
│   │   ├── models.py         # Request/response Pydantic models
│   │   ├── sse.py            # SSE streaming utilities
│   │   ├── auth.py           # Authentication helpers
│   │   └── db_subscriber.py  # Persists events to database
│   ├── agent/
│   │   ├── runtime/          # Agent orchestration engine
│   │   │   ├── orchestrator.py       # AgentOrchestrator — single-agent ReAct loop
│   │   │   ├── planner.py           # PlannerOrchestrator — task decomposition
│   │   │   ├── sub_agent_manager.py # SubAgentManager — concurrent agent coordination
│   │   │   ├── task_runner.py       # TaskAgentRunner — focused sub-task execution
│   │   │   ├── helpers.py           # apply_response_to_state, process_tool_calls
│   │   │   └── observer.py          # Context compaction for long conversations
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
│   │   │       ├── spawn_task_agent.py   # Spawn sub-agents
│   │   │       ├── wait_for_agents.py    # Wait for sub-agent completion
│   │   │       └── send_message.py       # Agent-to-agent messaging
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
│   │   │   ├── models.py        # ORM models (Conversation, Message, Event, Artifact, AgentRun)
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
│   ├── migrations/           # Alembic migration scripts
│   └── tests/                # 50+ test files
├── web/
│   ├── src/
│   │   ├── app/              # Next.js App Router
│   │   │   └── (main)/      # Main layout group
│   │   │       ├── page.tsx          # Conversation page
│   │   │       ├── skills/page.tsx   # Skills browser
│   │   │       └── mcp/page.tsx      # MCP configuration
│   │   ├── features/
│   │   │   ├── conversation/         # Chat interface
│   │   │   │   ├── api/              # conversation-api.ts, history-api.ts
│   │   │   │   ├── components/       # ConversationView, ChatInput, WelcomeScreen, etc.
│   │   │   │   └── hooks/            # use-conversation, use-pending-ask
│   │   │   ├── agent-computer/       # Agent execution display
│   │   │   │   ├── components/       # AgentComputerPanel, AgentProgressCard, ToolOutputRenderer
│   │   │   │   ├── hooks/            # use-agent-state
│   │   │   │   └── lib/              # format-tools, tool-constants
│   │   │   ├── skills/               # Skills browser & selector
│   │   │   │   ├── api/              # skills-api.ts
│   │   │   │   ├── components/       # SkillsPage, SkillSelector, SkillCard
│   │   │   │   └── hooks/            # use-skills-cache
│   │   │   └── mcp/                  # MCP configuration
│   │   │       ├── api/              # mcp-api.ts
│   │   │       └── components/       # MCPPage, MCPDialog, TransportToggle
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
├── container/                # Sandbox Docker images
│   ├── Dockerfile.default        # Standard tools (node, python, git)
│   ├── Dockerfile.data_science   # ML tools (pandas, numpy, matplotlib)
│   ├── Dockerfile.browser        # Playwright + browser
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
| `POST` | `/skills/install` | Install skill from GitHub URL. Body: `url` |
| `DELETE` | `/skills/{name}` | Uninstall a skill |

### MCP

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mcp/servers` | List connected MCP servers |
| `POST` | `/mcp/servers` | Connect an MCP server. Body: transport config |
| `DELETE` | `/mcp/servers/{name}` | Disconnect an MCP server |

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
| `artifact_created` | New artifact available |
| `preview_available` / `preview_stopped` | HTML/image preview lifecycle |
| `conversation_title` | Auto-generated conversation title |

---

## Key Modules

### Runtime Engine (`agent/runtime/`)

The runtime engine implements the ReAct (Reason + Act) loop:

- **`AgentOrchestrator`** — Single-agent loop. Calls LLM, executes tool calls, emits events, repeats until `end_turn` or max iterations (50). Uses `AgentState` (frozen dataclass) for immutable state — every mutation returns a new instance.

- **`PlannerOrchestrator`** — Extends the ReAct loop with task decomposition. Breaks complex requests into sub-tasks, spawns worker agents via `SubAgentManager`, and coordinates results.

- **`SubAgentManager`** — Manages concurrent agents (max 5 concurrent, 20 total). Handles dependency tracking (`depends_on`), per-agent tool registries, and an async message bus for agent-to-agent communication.

- **`TaskAgentRunner`** — Executes a single sub-task with its own sandbox. Returns `AgentResult` (frozen) with success status, summary, and artifacts.

- **`Observer`** — Context compaction. Keeps the first user message and last 5 interactions in full; truncates older tool results to 100-char previews.

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
- **Matching** — Keyword overlap between user message and skill descriptions
- **Activation** — Best-match skill prompt injected into orchestrator; agent restricted to allowed tools
- **Installation** — Clone from GitHub via `SkillInstaller`

### State Persistence (`agent/state/`)

SQLAlchemy async ORM with five models:

| Model | Purpose |
|-------|---------|
| `ConversationModel` | Top-level conversation record |
| `MessageModel` | Individual messages (user/assistant/tool) |
| `EventModel` | Raw event stream for replay |
| `ArtifactModel` | Generated file metadata |
| `AgentRunModel` | Sub-agent execution records |

Accessed through `ConversationRepository` (repository pattern). Public APIs return frozen Pydantic DTOs.

---

## Environment Variables

Required in `backend/.env` (see `backend/.env.example`):

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `TAVILY_API_KEY` | Tavily API key for web search |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string (`postgresql+asyncpg://...`) |
| `REDIS_URL` | — | Redis URL for caching |
| `SANDBOX_PROVIDER` | `boxlite` | Sandbox backend: `boxlite`, `e2b`, or `local` |
| `E2B_API_KEY` | — | E2B API key (if using E2B provider) |
| `MINIMAX_API_KEY` | — | MiniMax API key (for image generation) |
| `STORAGE_PROVIDER` | `local` | Artifact storage: `local` or `r2` |
| `STORAGE_DIR` | `./artifacts` | Local artifact storage directory |
| `R2_ACCOUNT_ID` | — | Cloudflare R2 account (if using R2 storage) |
| `R2_ACCESS_KEY_ID` | — | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | — | Cloudflare R2 secret key |
| `R2_BUCKET_NAME` | — | Cloudflare R2 bucket name |
| `PLANNING_MODEL` | `claude-sonnet-4-20250514` | Model for task planning |
| `TASK_MODEL` | `claude-sonnet-4-20250514` | Model for task execution |
| `LITE_MODEL` | `claude-haiku-4-5-20251001` | Model for simple sub-tasks |
| `THINKING_BUDGET` | `10000` | Extended thinking token budget (`0` = disabled) |
| `SKILLS_ENABLED` | `true` | Enable skill system |
| `SKILLS_REGISTRY_URL` | `https://api.agentskills.io` | External skill registry URL |
| `SKILLS_TRUST_PROJECT` | `true` | Trust project-level skills |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins |
| `API_KEY` | — | API authentication key |
| `RATE_LIMIT_PER_MINUTE` | — | Rate limiting threshold |

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

Applied to: `AgentState`, `ToolResult`, `ToolDefinition`, `SandboxConfig`, `SkillMetadata`, `LLMResponse`, `AgentEvent`, `TokenUsage`, `Artifact`, and all result types.

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
