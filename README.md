<p align="center">
  <img src="web/public/logo.svg" width="80" height="80" alt="HiAgent logo" />
</p>

<h1 align="center">HiAgent</h1>

<p align="center"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></p>

An open-source AI agent platform that turns natural language into sandboxed, multi-step actions — with real-time streaming, multi-agent planning, and an extensible skill system.

## What It Does

**Chat-driven task execution** — Users describe tasks in plain language. HiAgent's ReAct engine breaks them down, selects the right tools, and executes step-by-step while streaming progress in real time.

**Sandboxed code execution** — Every task runs in an isolated micro-VM (Boxlite). Agents can write and run code, install packages, query databases, automate browsers, and generate files — without touching your host machine.

**Multi-agent planning** — Complex tasks are automatically decomposed into sub-tasks with explicit plan declaration. A planner agent coordinates multiple worker agents that run concurrently, each with their own sandbox. Plan steps are tracked and displayed in real-time.

**Extensible skill system** — Skills are portable YAML definitions that teach agents new methodologies. Skills define instructions, allowed tools, and sandbox requirements. Import from GitHub coming soon.

**MCP integration** — Connect external tools via the Model Context Protocol. Add MCP servers to extend agent capabilities with third-party APIs and services.

**Real-time streaming** — The frontend renders every step as it happens: LLM reasoning, tool execution, code output, generated artifacts, and sub-agent progress — all via Server-Sent Events.

## Screenshots

| Multi-Agent Planning | Skills System | MCP Integration |
|:---:|:---:|:---:|
| ![Multi-Agent Planning](images/multi-agents.png) | ![Skills System](images/skills.png) | ![MCP Integration](images/mcp.png) |

## Features

- **Conversational interface** with file upload, skill selection, and follow-up messages
- **20+ built-in tools** — web search, code execution, browser automation (with step tracking), computer use (with action metadata), file operations, database queries, image generation, document generation
- **Plan mode** — Explicit task decomposition with step names, descriptions, and progress tracking via checklist panel
- **Artifact management** — Files generated in the sandbox are extracted and available for download/preview
- **Extended thinking** — Configurable thinking budget for deeper reasoning on complex tasks
- **Persistent memory** — Agents remember context across conversation turns
- **Conversation history** — Full persistence with PostgreSQL
- **Agent evaluation system** — YAML-defined eval cases with programmatic and LLM-as-judge grading, covering tool use, skill invocation, sub-agent spawning, and agent handoff
- **Dark/light theme** with internationalization (English, Chinese)
- **Keyboard-first UX** — Command palette (Cmd+K), responsive layout

## Quick Start

### Prerequisites

- Python 3.12+, Node.js (with npm), [`uv`](https://docs.astral.sh/uv/)
- PostgreSQL (optional, for conversation persistence)

### Setup

```bash
make install

# Create backend/.env (see backend/.env.example)
# ANTHROPIC_API_KEY=...
# TAVILY_API_KEY=...

make dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12+, FastAPI, Anthropic SDK, SQLAlchemy (async), Alembic |
| Frontend | Next.js 15, React 19, Tailwind CSS 4, Zustand, Framer Motion, Radix UI |
| Sandbox | Boxlite micro-VMs, E2B (cloud), Docker |
| Database | PostgreSQL, Redis (optional) |
| Package Manager | uv (backend), npm (frontend) |

## Documentation

- [Local Setup Guide](docs/setup.md) — Step-by-step instructions to get HiAgent running on your machine
- [Development Guide](docs/development.md) — Commands, architecture, API reference, environment variables, and contribution workflow
- [Design Style Guide](docs/DESIGN_STYLE_GUIDE.md) — UI component patterns, color system, typography, and accessibility
- [Brand Guidelines](docs/brand-guidelines.md) — Brand identity, color palette, and visual design language

## License

Private
