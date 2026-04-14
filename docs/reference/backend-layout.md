# Backend directory layout (`backend/`)

## API layer

| Path | Role |
| --- | --- |
| `api/main.py` | FastAPI app factory; shared state (Claude client, sandbox, storage, DB) |
| `api/routes/` | HTTP routes: `conversations.py` (SSE, planning), `artifacts.py`, `skills.py`, `mcp.py`, `auth.py`, `library.py`, `channels.py` (Telegram webhook, bot config, channel conversations) |
| `api/auth/` | Auth middleware: proxy secret, rate limits, NextAuth header extraction |
| `api/channels/` | Channel integration: `schemas.py`, `repository.py`, `provider.py` (Telegram), `responder.py` (SSE → channel), `router.py` (link tokens, accounts) |
| `api/builders.py` | Orchestrator and sandbox factory helpers |

## Agent runtime

| Path | Role |
| --- | --- |
| `agent/runtime/orchestrator.py` | Core ReAct loop, immutable state |
| `agent/runtime/planner.py` | Task decomposition / planning |
| `agent/runtime/sub_agent_manager.py` | Concurrent sub-agents, failure propagation (cancel / degrade / replan), timeouts |
| `agent/runtime/task_runner.py` | Sub-task executor; per-agent metrics (duration, iterations, tools, tokens) |
| `agent/runtime/skill_selector.py` | LLM skill selection: explicit name → LLM pick → keyword fallback |
| `agent/context/compaction.py` | Token-aware context compaction, CJK-aware estimation, fallbacks |
| `agent/context/profiles.py` | Runtime-specific compaction policy resolution (`web`, `channel`, `planner`, `task_agent`) |
| `agent/runtime/observer.py` | Compatibility shim re-exporting `agent.context` compaction APIs |

## Agent systems

| Path | Role |
| --- | --- |
| `agent/tools/` | Tool abstractions, immutable registry, local and sandbox tools |
| `agent/sandbox/` | Providers: `boxlite_provider.py`, `e2b_provider.py`, `local_provider.py` |
| `agent/skills/` | `SKILL.md` frontmatter → loadable execution state |
| `agent/memory/` | Persistent memory (`PersistentMemoryStore`); see [Agent memory](../agent-memory-management.md) |
| `agent/state/` | SQLAlchemy async persistence, Pydantic schemas |

## Evaluations

| Path | Role |
| --- | --- |
| `evals/` | YAML cases, `llm_judge.py`, `grader.py` — see [Agent evals](agent-evals.md) |

## Related

- [Architecture overview](architecture-overview.md)
- [Environment](environment.md)
