# Environment variables

Configure the backend via **`backend/.env`**. See **`backend/.env.example`** for names and defaults.

## Required (typical)

- `ANTHROPIC_API_KEY`
- `SEARCH_PROVIDER` (defaults to `tavily`)
- `TAVILY_API_KEY` when `SEARCH_PROVIDER=tavily`, or `EXA_API_KEY` when `SEARCH_PROVIDER=exa`

## Optional (high level)

| Area | Examples |
| --- | --- |
| Search | `SEARCH_PROVIDER` — `tavily` or `exa`; exposes the selected provider as the canonical `web_search` tool |
| Database | `DATABASE_URL` (SQLite default; PostgreSQL in production) |
| Sandbox | `SANDBOX_PROVIDER` — `boxlite` or `e2b` in the current backend builder |
| Cache | `REDIS_URL` |
| Artifacts | `STORAGE_PROVIDER` — `local` / `r2` |
| Skills | `SKILLS_ENABLED`, `SKILL_SELECTOR_MODEL`, registry URLs |
| Model / thinking | `LITE_MODEL`, `THINKING_BUDGET` |
| Memory | `INITIAL_CONVERSATION_MEMORY_LIMIT`, `MEMORY_PROMPT_ENTRY_MAX_CHARS`, `MEMORY_PROMPT_MAX_CHARS` |
| Compaction | Global `COMPACT_*` defaults plus optional runtime overrides such as `COMPACT_CHANNEL_TOKEN_BUDGET` and `COMPACT_TASK_AGENT_DIALOGUE_FALLBACK_CHARS`; see `config/settings.py` |
| Agent limits | `MAX_ITERATIONS`, `MAX_AGENT_ITERATIONS`, `MAX_CONCURRENT_AGENTS`, `MAX_TOTAL_AGENTS`, `AGENT_TIMEOUT_SECONDS`, `AGENT_GLOBAL_TOKEN_BUDGET` |
| Auth | `AUTH_REQUIRED`, `PROXY_SECRET` |
| Channels | `CHANNELS_ENABLED`, `CHANNELS_WEBHOOK_BASE_URL` |

## Runtime notes

- `SANDBOX_PROVIDER` is resolved in `api/builders.py`. The current builder accepts `boxlite` and `e2b`; a local provider implementation exists in the codebase but is not selected by `_build_sandbox_provider()`.
- `SEARCH_PROVIDER` is resolved in `api/builders.py`. The builder registers exactly one `web_search` tool: Tavily when set to `tavily`, Exa when set to `exa`.
- `SKILLS_ENABLED` controls discovery, registry initialization, prompt catalog injection, and activation-tool registration.
- `THINKING_BUDGET` is passed to the main agent orchestrator and controls provider-native extended thinking when supported.
- Execution routing uses `EXECUTION_ROUTER_MODEL` or falls back to `COMPLEXITY_CLASSIFIER_MODEL` / `LITE_MODEL`.
- Runtime-specific compaction overrides are available for `WEB`, `CHANNEL`, `PLANNER`, and `TASK_AGENT` profiles.

## Desktop

Dev-only: `SYNAPSE_FRONTEND_PORT`, `SYNAPSE_BACKEND_PORT`, `SYNAPSE_PROJECT_DIR`

Release-only: `SYNAPSE_FRONTEND_URL`, `SYNAPSE_BACKEND_URL`

See [Desktop shell](desktop-shell.md).

## Related

- [Database migrations](database-migrations.md)
- [Agent memory](../agent-memory-management.md) (compaction and memory-related env vars)
