<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/favicon-dark.svg" />
    <img src="web/public/favicon-light.svg" width="80" height="80" alt="HiAgent logo" />
  </picture>
</p>

<h1 align="center">HiAgent</h1>

<p align="center"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></p>

An open-source AI agent platform that does the work for you. Describe any task in plain language — HiAgent plans, codes, browses, and delivers results in a secure sandbox, streaming every step in real time.

## What It Does

**Chat-driven task execution** — Users describe tasks in plain language. HiAgent's ReAct engine breaks them down, selects the right tools, and executes step-by-step while streaming progress in real time.

**Sandboxed code execution** — Every task runs in an isolated micro-VM (Boxlite). Agents can write and run code, install packages, query databases, automate browsers, and generate files — without touching your host machine.

**Multi-agent planning** — Complex tasks are automatically decomposed into sub-tasks with explicit plan declaration. A planner agent coordinates multiple worker agents that run concurrently, each with their own sandbox. Plan steps are tracked and displayed in real-time.

**Extensible skill system** — Skills are portable YAML definitions that teach agents new methodologies. Skills define instructions, allowed tools, and sandbox requirements. Import from GitHub coming soon.

**MCP integration** — Connect external tools via the Model Context Protocol. Add MCP servers to extend agent capabilities with third-party APIs and services.

**Channel integrations** — Connect messaging platforms like Telegram to chat with HiAgent directly from your favorite apps. Supports bot configuration, account linking, and seamless conversation sync.

**Real-time streaming** — The frontend renders every step as it happens: LLM reasoning, tool execution, code output, generated artifacts, and sub-agent progress — all via Server-Sent Events.

## Screenshots

| Multi-Agent Planning | Skills System | MCP Integration |
|:---:|:---:|:---:|
| ![Multi-Agent Planning](images/multi-agents.png) | ![Skills System](images/skills.png) | ![MCP Integration](images/mcp.png) |

## Brand Assets

- **Theme-adaptive logo**: `web/public/logo.svg` uses light/dark color treatment via `prefers-color-scheme`.
- **App logo component**: `web/src/shared/components/Logo.tsx` maps logo colors to semantic design tokens in `web/src/app/globals.css`.
- **Favicon variants**:
  - SVG: `web/public/favicon-light.svg`, `web/public/favicon-dark.svg`
  - PNG/ICO: `web/public/favicon-16.png`, `web/public/favicon-32.png`, `web/public/favicon.ico`, plus dark PNG variants
  - Apple touch icons: `web/public/apple-touch-icon.png` and `web/public/apple-touch-icon-dark.png`
- **Metadata wiring**: `web/src/app/layout.tsx` serves light/dark icon variants using Next.js `icons` entries with `media`.

## Features

- **Google OAuth authentication** with per-user skills and MCP server configurations
- **Conversational interface** with file upload, skill selection, and follow-up messages
- **20+ built-in tools** — web search, code execution, browser automation (with step tracking), computer use (with action metadata), file operations, database queries, image generation, document generation
- **Plan mode** — Explicit task decomposition with step names, descriptions, and progress tracking via checklist panel
- **Artifact management** — Files generated in the sandbox are extracted and available for download/preview, with a dedicated library page for browsing all artifacts
- **Extended thinking** — Configurable thinking budget for deeper reasoning on complex tasks
- **Persistent memory** — Agents remember context across conversation turns
- **Conversation history** — Full persistence with PostgreSQL
- **Agent evaluation system** — YAML-defined eval cases with programmatic and LLM-as-judge grading, covering tool use, skill invocation, sub-agent spawning, and agent handoff
- **Channel integrations** — Connect messaging platforms (Telegram) to chat with HiAgent from your favorite apps
- **User preferences** — Persistent theme (dark/light/system) and locale settings per user
- **Dark/light theme** with internationalization (English, Chinese)
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

HiAgent also ships as a native desktop app built with [Tauri v2](https://v2.tauri.app/). It wraps the same web UI in a native window with automatic backend/frontend process management.

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
| Frontend | Next.js 15, React 19, Tailwind CSS 4, Zustand, Framer Motion, Radix UI |
| Desktop | Tauri v2, Rust, WKWebView (macOS) / WebView2 (Windows) |
| Sandbox | Boxlite micro-VMs, E2B (cloud), Docker |
| Database | PostgreSQL, Redis (optional) |
| Package Manager | uv (backend), npm (frontend) |

## Documentation

- [Local Setup Guide](docs/setup.md) — Step-by-step instructions to get HiAgent running on your machine
- [Development Guide](docs/development.md) — Commands, architecture, API reference, environment variables, and contribution workflow
- [Desktop App Guide](docs/desktop-app.md) — Tauri desktop app setup, configuration, OAuth flow, and troubleshooting
- [Design Style Guide](docs/DESIGN_STYLE_GUIDE.md) — UI component patterns, color system, typography, and accessibility
- [Brand Guidelines](docs/brand-guidelines.md) — Brand identity, color palette, and visual design language

## License

[Apache-2.0](LICENSE)
