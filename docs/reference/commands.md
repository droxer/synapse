# Makefile and project commands

Run tasks from the **repository root** via `make` unless noted otherwise.

## Development

| Command | Description |
| --- | --- |
| `make dev` | Backend (port 8000) + web (port 3000) concurrently |
| `make backend` | Backend only: `cd backend && uv run python -m api.main` |
| `make web` | Frontend only: `cd web && npm run dev` |

## Install and build

| Command | Description |
| --- | --- |
| `make install` | All dependencies (backend + web) |
| `make install-backend` | `cd backend && uv sync` |
| `make install-web` | `cd web && npm install` |
| `make build-web` | `cd web && npm run build` |
| `make build-sandbox` | Build Boxlite sandbox Docker images |
| `make push-sandbox` | Push sandbox images to GHCR |
| `make generate-favicons` | Generate favicon/icon assets from SVG sources |

## Quality

| Command | Description |
| --- | --- |
| `make pre-commit` | Install pre-commit hooks |
| `make pre-commit-all` | Run pre-commit on all files |
| `make test` | Backend tests: `cd backend && uv run pytest` |
| `make lint` | Backend lint: `cd backend && uv run ruff check .` |
| `make format` | Backend format: `cd backend && uv run ruff format .` |
| `make lint-web` | `cd web && npx eslint src/` |
| `make test-web` | `cd web && npm test` |
| `make audit-design-tokens` | `cd web && npm run audit:design-tokens` |

## Desktop

| Command | Description |
| --- | --- |
| `make desktop` | Tauri desktop app (dev) |
| `make build-desktop` | Tauri production bundle (e.g. `.app`) |

See also: [Desktop shell](desktop-shell.md) and [Desktop app](../desktop-app.md).

## Related

- [Backend testing and linting](backend-testing.md)
- [Agent evals](agent-evals.md)
- [Database migrations](database-migrations.md)
