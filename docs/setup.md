**English** | [简体中文](zh-CN/setup.md)

# Local Setup Guide

Step-by-step instructions to get Synapse running on your machine.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.12+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+ (with npm) | [nodejs.org](https://nodejs.org/) |
| uv | latest | [docs.astral.sh/uv](https://docs.astral.sh/uv/) |
| PostgreSQL | 14+ (optional) | [postgresql.org](https://www.postgresql.org/download/) |
| Docker | latest (optional) | [docker.com](https://www.docker.com/get-started/) |

> **PostgreSQL** is optional — without it, conversations are not persisted across server restarts.
> **Docker** is only needed if you want sandboxed code execution via Boxlite.

### Verify Prerequisites

```bash
python3 --version   # 3.12+
node --version       # 18+
uv --version         # any recent version
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/droxer/Synapse.git
cd Synapse
```

---

## 2. Install Dependencies

```bash
make install
```

This runs `uv sync` for the backend and `npm install` for the frontend.

To install them separately:

```bash
make install-backend   # cd backend && uv sync
make install-web       # cd web && npm install
```

---

## 3. Configure Environment Variables

Copy the example file and fill in your API keys:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```bash
# Required — you must set these
ANTHROPIC_API_KEY=sk-ant-...
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
# EXA_API_KEY=...                 # Use instead when SEARCH_PROVIDER=exa

# Optional — use any Anthropic-compatible LLM provider
# ANTHROPIC_BASE_URL=https://api.anthropic.com   # Default (Anthropic)
# ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1  # OpenRouter example

# Optional — sandbox provider (default: boxlite, pulls prebuilt images automatically)
# SANDBOX_PROVIDER=boxlite      # Recommended — requires Docker
# SANDBOX_PROVIDER=e2b          # Cloud sandbox

# Optional — database (remove or leave empty to skip persistence)
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/synapse
```

### LLM Provider

Synapse works with any LLM provider that exposes an Anthropic-compatible API. Set `ANTHROPIC_BASE_URL` to point to your provider and `ANTHROPIC_API_KEY` to the corresponding key.

| Provider | `ANTHROPIC_BASE_URL` | Notes |
|----------|---------------------|-------|
| Anthropic (default) | `https://api.anthropic.com` | Direct Claude API |
| OpenRouter | `https://openrouter.ai/api/v1` | Access multiple models |
| Amazon Bedrock | Use the Bedrock endpoint URL | Via Anthropic SDK |
| Any compatible proxy | Your proxy URL | Must support the Anthropic messages API |

You can also customize which models are used for different tasks:

```bash
PLANNING_MODEL=claude-sonnet-4-6           # Model for task planning
TASK_MODEL=claude-sonnet-4-6               # Model for task execution
LITE_MODEL=claude-haiku-4-5-20251001       # Model for simple sub-tasks
```

Model IDs are provider-specific and must match `ANTHROPIC_BASE_URL`. Keep defaults on active, stable model IDs and avoid deprecated model IDs.

### API Keys

| Key | Where to get it | Required |
|-----|----------------|----------|
| `ANTHROPIC_API_KEY` | Your LLM provider | Yes |
| `TAVILY_API_KEY` | [tavily.com](https://tavily.com/) | Yes when `SEARCH_PROVIDER=tavily` |
| `EXA_API_KEY` | [exa.ai](https://exa.ai/) | Yes when `SEARCH_PROVIDER=exa` |
| `MINIMAX_API_KEY` | [minimaxi.com](https://www.minimaxi.com/) | No (enables image generation) |
| `E2B_API_KEY` | [e2b.dev](https://e2b.dev/) | No (only if `SANDBOX_PROVIDER=e2b`) |

### Channel Integrations

To enable Telegram channel integration:

```bash
# Enable channels feature
CHANNELS_ENABLED=true

# Webhook base URL (required for Telegram to send webhooks)
# Must be publicly accessible
CHANNELS_WEBHOOK_BASE_URL=https://your-domain.com
```

The webhook URL will be: `{CHANNELS_WEBHOOK_BASE_URL}/api/channels/telegram/webhook`

**Setting up Telegram:**
1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram
2. Copy the bot token and configure it in the Channels page
3. Synapse will automatically set up the webhook

### Sandbox Providers

| Provider | When to use | Requires |
|----------|------------|----------|
| `boxlite` | Recommended — isolated micro-VMs with prebuilt images | Docker |
| `e2b` | Cloud sandboxes | `E2B_API_KEY` |

For the best experience, use `SANDBOX_PROVIDER=boxlite` (the default). Prebuilt images are available on GHCR — Docker will pull them automatically on first run, no manual build needed.
If you do not want to run Boxlite locally, switch to `SANDBOX_PROVIDER=e2b` and provide `E2B_API_KEY`.

---

## 4. Set Up the Database (Optional)

If you want conversation persistence, create a PostgreSQL database:

```bash
createdb synapse
```

Make sure `DATABASE_URL` in `backend/.env` points to it:

```
DATABASE_URL=postgresql+asyncpg://localhost:5432/synapse
```

Then run migrations:

```bash
cd backend && uv run alembic upgrade head
```

> Skip this step if you don't need persistence. The app works without a database.

---

## 5. Start the Dev Server

```bash
make dev
```

This starts both services concurrently:
- **Backend** (FastAPI): http://localhost:8000
- **Frontend** (Next.js): http://localhost:3000

Open http://localhost:3000 in your browser.

To run them separately (useful for debugging):

```bash
# Terminal 1
make backend    # cd backend && uv run python -m api.main

# Terminal 2
make web        # cd web && npm run dev
```

---

## 6. Sandbox Images (Optional)

Boxlite sandbox images are published to GHCR. Docker pulls them automatically when needed — **no manual build required**.

If you want to customize the images or build from source:

```bash
make build-sandbox
```

This builds three images:
- `synapse-sandbox-default` — Python, Node.js, git
- `synapse-sandbox-data-science` — pandas, numpy, matplotlib
- `synapse-sandbox-browser` — Playwright + Chromium

---

## 7. Desktop App (Optional)

Synapse also ships as a native desktop app built with Tauri v2. It wraps the same web UI in a native window.

```bash
# Dev mode — opens Tauri window with hot reload
make desktop

# Production build — creates .app bundle
make build-desktop
```

See [Desktop App Guide](desktop-app.md) for details.

---

## Project Structure

```
Synapse/
├── backend/           # Python/FastAPI backend
│   ├── api/           # Routes, middleware, auth, app factory
│   ├── agent/         # Agent runtime, tools, sandbox, skills, memory
│   ├── config/        # Settings (Pydantic)
│   ├── evals/         # Agent evaluation system (YAML cases, grading, reporting)
│   ├── migrations/    # Alembic database migrations
│   └── tests/         # pytest test suite
├── web/               # Next.js frontend
│   └── src/
│       ├── app/       # Pages (App Router)
│       │   └── font-assets/ # Bundled local Geist/Noto font assets
│       ├── features/  # Feature modules (conversation, agent-computer, skills, mcp, library, channels)
│       ├── shared/    # Shared components, hooks, stores, types
│       └── i18n/      # Internationalization (en, zh-CN, zh-TW)
├── container/         # Sandbox Dockerfiles
├── docs/              # Documentation
└── Makefile           # Dev commands
```

---

## Common Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start backend + frontend |
| `make backend` | Start backend only |
| `make web` | Start frontend only |
| `make install` | Install all dependencies |
| `make build-web` | Production build of frontend |
| `make build-sandbox` | Build sandbox Docker images |
| `make migrate` | Run database migrations |
| `make desktop` | Start Tauri desktop app (dev mode) |
| `make build-desktop` | Build Tauri desktop app (.app bundle) |
| `make pre-commit` | Install pre-commit hooks |
| `make pre-commit-all` | Run pre-commit on all files |
| `make lint-web` | Lint frontend code |
| `make test-web` | Run frontend tests |
| `make audit-design-tokens` | Audit frontend token/color/shadow guardrails |
| `make clean` | Remove `.venv`, `node_modules`, `.next` |

### Backend Testing & Linting

Run from the `backend/` directory:

```bash
uv run pytest                          # Run all tests
uv run pytest path/to/test.py::test_fn # IMPORTANT: Run single test function
uv run pytest --cov                    # With coverage report
uv run ruff check .                    # Lint
uv run ruff format .                   # Auto-format
```

---

## Troubleshooting

### Port already in use

```bash
# Find and kill the process on port 8000 or 3000
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### `uv` not found

Install uv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Database connection refused

- Check PostgreSQL is running: `pg_isready`
- Verify `DATABASE_URL` in `backend/.env` matches your local setup
- If you don't need persistence, remove or comment out `DATABASE_URL`

### Sandbox errors with `boxlite`

- Make sure Docker is running: `docker info`
- Build images first: `make build-sandbox`
- Or switch to `SANDBOX_PROVIDER=e2b` if you have an E2B API key

### Frontend can't reach backend

The frontend proxies `/api/*` requests to `http://127.0.0.1:8000`. Make sure the backend is running on port 8000. If you changed the backend port, update `web/next.config.ts`.

---

## Next Steps

- [Development Guide](development.md) — Architecture deep-dive, API reference, environment variables
- [Design Style Guide](DESIGN_STYLE_GUIDE.md) — UI patterns, color system, typography
- [Brand Guidelines](brand-guidelines.md) — Brand identity and visual language
