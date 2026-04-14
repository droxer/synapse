# Environment variables

Configure the backend via **`backend/.env`**. See **`backend/.env.example`** for names and defaults.

## Required (typical)

- `ANTHROPIC_API_KEY`
- `TAVILY_API_KEY`

## Optional (high level)

| Area | Examples |
| --- | --- |
| Database | `DATABASE_URL` (SQLite default; PostgreSQL in production) |
| Sandbox | `SANDBOX_PROVIDER` — `boxlite` / `e2b` / `local` |
| Cache | `REDIS_URL` |
| Artifacts | `STORAGE_PROVIDER` — `local` / `r2` |
| Skills | `SKILLS_ENABLED`, `SKILL_SELECTOR_MODEL`, registry URLs |
| Model / thinking | `LITE_MODEL`, `THINKING_BUDGET` |
| Compaction | Global `COMPACT_*` defaults plus optional runtime overrides such as `COMPACT_CHANNEL_TOKEN_BUDGET` and `COMPACT_TASK_AGENT_DIALOGUE_FALLBACK_CHARS`; see `config/settings.py` |
| Agent limits | `AGENT_TIMEOUT_SECONDS` |
| Auth | `AUTH_REQUIRED`, `PROXY_SECRET` |
| Channels | `CHANNELS_ENABLED`, `CHANNELS_WEBHOOK_BASE_URL` |

## Desktop

Optional: `SYNAPSE_FRONTEND_PORT`, `SYNAPSE_BACKEND_PORT`, `SYNAPSE_PROJECT_DIR` (see [Desktop shell](desktop-shell.md)).

## Related

- [Database migrations](database-migrations.md)
- [Agent memory](../agent-memory-management.md) (compaction and memory-related env vars)
