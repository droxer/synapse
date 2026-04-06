# [CLAUDE.md](http://CLAUDE.md)

Navigation map for **Claude Code** (claude.ai/code) in this repository. Detailed content lives under `**docs/reference/`**; the full doc tree is `**[docs/README.md](docs/README.md)`**.

## Commands and quality


| Topic                                         | Doc                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Makefile (`make dev`, install, lint, desktop) | `[docs/reference/commands.md](docs/reference/commands.md)`                       |
| pytest, ruff                                  | `[docs/reference/backend-testing.md](docs/reference/backend-testing.md)`         |
| Agent evals (`make evals`, JSON report)       | `[docs/reference/agent-evals.md](docs/reference/agent-evals.md)`                 |
| Alembic migrations                            | `[docs/reference/database-migrations.md](docs/reference/database-migrations.md)` |


## Code style


| Topic                | Doc                                                                        |
| -------------------- | -------------------------------------------------------------------------- |
| Python / FastAPI     | `[docs/reference/style-python.md](docs/reference/style-python.md)`         |
| TypeScript / Next.js | `[docs/reference/style-typescript.md](docs/reference/style-typescript.md)` |
| Design system (tokens, radii, colors, typography) | `[docs/reference/design-system.md](docs/reference/design-system.md)` |


## Architecture and layout


| Topic                                  | Doc                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Stack overview (FastAPI, Next.js, SSE) | `[docs/reference/architecture-overview.md](docs/reference/architecture-overview.md)` |
| `backend/` map                         | `[docs/reference/backend-layout.md](docs/reference/backend-layout.md)`               |
| `web/` map                             | `[docs/reference/frontend-layout.md](docs/reference/frontend-layout.md)`             |
| Tauri desktop shell                    | `[docs/reference/desktop-shell.md](docs/reference/desktop-shell.md)`                 |


## Runtime behavior


| Topic                                          | Doc                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Web chat flow                                  | `[docs/reference/data-flow-chat.md](docs/reference/data-flow-chat.md)`         |
| Channels (Telegram, etc.)                      | `[docs/reference/data-flow-channels.md](docs/reference/data-flow-channels.md)` |
| Patterns (immutability, events, tools, skills) | `[docs/reference/patterns.md](docs/reference/patterns.md)`                     |


## Memory, environment, and longer guides


| Topic                                         | Doc                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Agent memory (compaction, persistence, facts) | `[docs/agent-memory-management.md](docs/agent-memory-management.md)` |
| Environment variables                         | `[docs/reference/environment.md](docs/reference/environment.md)`     |
| Full development guide                        | `[docs/development.md](docs/development.md)`                         |
| Setup                                         | `[docs/setup.md](docs/setup.md)`                                     |
| Desktop app (deep dive)                       | `[docs/desktop-app.md](docs/desktop-app.md)`                         |


## Agent instructions and index


| Topic                                         | Doc                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Where agent rules live (vs Cursor-only files) | `[docs/reference/agent-instructions-note.md](docs/reference/agent-instructions-note.md)` |
| All `reference/` shards                       | `[docs/reference/README.md](docs/reference/README.md)`                                   |
