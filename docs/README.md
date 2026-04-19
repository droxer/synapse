# Synapse documentation

## Reference shards (`reference/`)

Concise guides for agents and developers. Root navigation: **`AGENTS.md`** and **`CLAUDE.md`** in the repository root.

| Doc | Topic |
| --- | --- |
| [reference/commands.md](reference/commands.md) | Makefile: dev, install, lint, desktop |
| [reference/backend-testing.md](reference/backend-testing.md) | pytest, ruff |
| [reference/agent-evals.md](reference/agent-evals.md) | `make evals` harness |
| [reference/database-migrations.md](reference/database-migrations.md) | Alembic |
| [reference/style-python.md](reference/style-python.md) | Backend code style |
| [reference/style-typescript.md](reference/style-typescript.md) | Frontend code style |
| [reference/architecture-overview.md](reference/architecture-overview.md) | Stack and SSE overview |
| [reference/backend-layout.md](reference/backend-layout.md) | `backend/` map |
| [reference/frontend-layout.md](reference/frontend-layout.md) | `web/` map |
| [reference/desktop-shell.md](reference/desktop-shell.md) | Tauri sidecar |
| [reference/data-flow-chat.md](reference/data-flow-chat.md) | Web chat pipeline |
| [reference/data-flow-channels.md](reference/data-flow-channels.md) | Telegram-style channels |
| [reference/patterns.md](reference/patterns.md) | Immutability, events, tools, skills |
| [reference/environment.md](reference/environment.md) | `.env` overview |
| [reference/agent-instructions-note.md](reference/agent-instructions-note.md) | Where agent rules live |

## Topic guides

| Doc | Topic |
| --- | --- |
| [agent-memory-management.md](agent-memory-management.md) | Context compaction, KV memory, facts, `context_summary` |
| [evals.md](evals.md) | Detailed eval harness guide |
| [development.md](development.md) | Full development guide |
| [setup.md](setup.md) | Environment setup |
| [desktop-app.md](desktop-app.md) | Desktop packaging and architecture |
| [DESIGN_STYLE_GUIDE.md](DESIGN_STYLE_GUIDE.md) | UI conventions |
| [frontend-typography-review-2026-04-06.md](frontend-typography-review-2026-04-06.md) | Frontend typography audit + normalization plan |
| [brand-guidelines.md](brand-guidelines.md) | Brand |

## 简体中文

- [zh-CN/development.md](zh-CN/development.md)
- [zh-CN/setup.md](zh-CN/setup.md)
- [zh-CN/agent-memory-management.md](zh-CN/agent-memory-management.md)
- [zh-CN/DESIGN_STYLE_GUIDE.md](zh-CN/DESIGN_STYLE_GUIDE.md)
- [zh-CN/brand-guidelines.md](zh-CN/brand-guidelines.md)

## Design notes (`superpowers/`)

Specs and plans for larger features live under [superpowers/](superpowers/).
