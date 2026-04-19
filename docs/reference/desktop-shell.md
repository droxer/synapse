# Desktop shell (Tauri)

The desktop app lives under **`web/src-tauri/`**: **Tauri v2** wraps the same Next.js UI.

## Runtime modes

- **Dev (`make desktop`, `tauri dev`)**: the Rust sidecar starts and stops the local Python backend and Next.js dev server from the repo checkout.
- **Release (`make build-desktop`, `tauri build`)**: the packaged app does **not** start local dev servers. It connects only to explicitly configured Synapse frontend/backend URLs.

## Environment

Dev-only:

- `SYNAPSE_FRONTEND_PORT`
- `SYNAPSE_BACKEND_PORT`
- `SYNAPSE_PROJECT_DIR`

Release-only:

- `SYNAPSE_FRONTEND_URL`
- `SYNAPSE_BACKEND_URL`

## Health checks

The desktop shell attaches only to services that pass Synapse-specific health probes:

- Frontend: `GET /api/desktop/health` → `service: "synapse-web"`
- Backend: `GET /health` → `service: "synapse-api"`

## Deeper documentation

[Desktop app guide](../desktop-app.md) — architecture diagram, configuration, troubleshooting.

## Related

- [Makefile commands](commands.md) (`make desktop`, `make build-desktop`)
