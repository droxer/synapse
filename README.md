<p align="center">
  <img src="web/public/logo.svg" width="112" alt="Synapse logo" />
</p>

<h1 align="center">Synapse</h1>

<p align="center"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></p>

An open-source AI agent platform that does the work for you. Describe any task in plain language — Synapse plans, codes, browses, and delivers results in a secure sandbox, streaming every step in real time.

## What It Does

**Chat-driven task execution** — Users describe tasks in plain language. Synapse routes each turn into either a single-agent ReAct loop or planner-managed orchestration, then streams progress in real time.

**Sandboxed tool execution** — Agents can write and run code, install packages, query databases, automate browsers, manipulate files, and generate artifacts inside sandbox sessions created on demand by the configured provider.

**Planner-managed multi-agent work** — Planner mode can be forced per turn or auto-selected by the execution router. The planner declares a plan, spawns worker agents when decomposition is warranted, waits on results, and streams step and agent status live.

**Extensible skill system** — Skills are `SKILL.md` packages with frontmatter for description, allowed tools, dependencies, and sandbox hints. Synapse supports bundled skills plus install flows from git URLs, direct URLs, uploads, and a remote registry.

**MCP integration** — Connect external tools via the Model Context Protocol. Add MCP servers to extend agent capabilities with third-party APIs and services.

**Persistent memory and compaction** — Synapse injects user-scoped memory into prompts, compacts long-running conversations with runtime-specific policies, and supports verified fact retrieval for channel-style flows.

**Channel integrations** — Connect messaging platforms like Telegram to chat with Synapse directly from your favorite apps. Supports bot configuration, account linking, and seamless conversation sync.

**Real-time streaming UI** — The frontend renders plans, tool calls, thinking, artifacts, browser/computer-use output, and sub-agent progress from the SSE event stream as they happen.

## Screenshots

Synapse includes dedicated views for planning, skills, MCP configuration, artifact browsing, and channel integrations.

| Multi-Agent Planning | Skills System | MCP Integration |
|:---:|:---:|:---:|
| ![Multi-Agent Planning](images/multi-agents.png) | ![Skills System](images/skills.png) | ![MCP Integration](images/mcp.png) |

| Artifact Library | Web Channel Page | Telegram Channel Integration |
|:---:|:---:|:---:|
| ![Artifact Library](images/library.png) | ![Web Channel Page](images/channels.png) | ![Telegram Channel Integration](images/telegram.jpg) |

## Brand Assets

- **Theme-adaptive logo**: `web/public/logo.svg` uses strict monochrome lockups via `prefers-color-scheme`.
- **App logo component**: `web/src/shared/components/Logo.tsx` uses monochrome tokens from `web/src/app/globals.css` (`--logo-black`, `--logo-white`, `--logo-neutral-700`, `--logo-neutral-300`).
- **Favicon variants**:
  - SVG: `web/public/favicon-light.svg`, `web/public/favicon-dark.svg` (monochrome)
  - PNG/ICO: `web/public/favicon-16.png`, `web/public/favicon-32.png`, `web/public/favicon.ico`, plus dark PNG variants (`favicon-dark-16.png`, `favicon-dark-32.png`)
  - Apple touch icons: `web/public/apple-touch-icon.png`, `web/public/apple-touch-icon-dark.png`
  - PWA icons: `web/public/icon-192.png`, `web/public/icon-512.png`
- **Metadata wiring**: `web/src/app/layout.tsx` serves light/dark favicon SVG variants using Next.js `icons` entries with `media`.
- **Monochrome usage rules**: `docs/logo-monochrome-spec.md`

## Features

- **Google OAuth authentication** with per-user skills and MCP server configurations
- **Conversational interface** with file upload, skill selection, and follow-up messages
- **20+ built-in tools** — web search, code execution, browser automation (with step tracking), computer use (with action metadata), file operations, database queries, image generation, document generation
- **Execution routing** — `use_planner` can force planner mode, otherwise the backend classifies each turn into single-agent or planner-managed execution shapes
- **Plan mode** — Explicit task decomposition with step names, execution types, and live checklist/progress tracking
- **Artifact management** — Files generated in the sandbox are extracted and available for download/preview, with a dedicated library page for browsing all artifacts
- **Extended thinking** — Configurable thinking budget for deeper reasoning on complex tasks
- **Persistent memory** — User-scoped key-value memory, channel facts, and runtime context compaction for long conversations
- **Conversation history** — Full persistence with PostgreSQL
- **Agent evaluation system** — YAML-defined eval cases with programmatic and LLM-as-judge grading, covering tool use, skill invocation, sub-agent spawning, and agent handoff
- **Channel integrations** — Connect messaging platforms (Telegram) to chat with Synapse from your favorite apps
- **User preferences** — Persistent theme (dark/light/system) and locale settings per user
- **Dark/light theme** with internationalization (English, Simplified Chinese, Traditional Chinese)
- **Keyboard-first UX** — Command palette (Cmd+K), responsive layout

## Quick Start

### Prerequisites

- Python 3.12+, Node.js (with npm), [`uv`](https://docs.astral.sh/uv/)
- PostgreSQL (optional, for conversation persistence)
- Rust 1.77+ (optional, for desktop app)

### Web

```bash
make install

# Create backend/.env (see backend/.env.example)
# ANTHROPIC_API_KEY=...
# TAVILY_API_KEY=...

make dev
```

Open [http://localhost:3000](http://localhost:3000).

### Desktop App

Synapse also ships as a native desktop app built with [Tauri v2](https://v2.tauri.app/). It wraps the same web UI in a native window with automatic backend/frontend process management.

```bash
# Dev mode
make desktop

# Production build (.app / .msi / .deb)
make build-desktop
```

The desktop app manages backend and frontend as sidecar processes — if they're already running (e.g. via `make dev`), it connects to the existing services. Google OAuth opens in the system browser and hands the session back to the desktop window automatically.

See [Desktop App Guide](docs/desktop-app.md) for configuration and troubleshooting.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12+, FastAPI, Anthropic SDK, SQLAlchemy (async), Alembic |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, Zustand, Framer Motion, Radix UI |
| Desktop | Tauri v2, Rust, WKWebView (macOS) / WebView2 (Windows) |
| Sandbox | Boxlite micro-VMs, E2B cloud sandboxes, provider-specific browser templates |
| Database | PostgreSQL, Redis (optional) |
| Package Manager | uv (backend), npm (frontend) |

## Documentation

- [Local Setup Guide](docs/setup.md) — Step-by-step instructions to get Synapse running on your machine
- [Development Guide](docs/development.md) — Commands, architecture, API reference, environment variables, and contribution workflow
- [Documentation Index](docs/README.md) — Reference shards and deeper docs, including agent runtime, memory, and evals
- [Desktop App Guide](docs/desktop-app.md) — Tauri desktop app setup, configuration, OAuth flow, and troubleshooting
- [Agent Memory Guide](docs/agent-memory-management.md) — Working context, compaction, persistent memory, and verified facts
- [Design Style Guide](docs/DESIGN_STYLE_GUIDE.md) — UI component patterns, color system, typography, and accessibility
- [Brand Guidelines](docs/brand-guidelines.md) — Brand identity, color palette, and visual design language

## License

[Apache-2.0](LICENSE)
