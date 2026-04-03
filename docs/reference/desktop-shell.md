# Desktop shell (Tauri)

The desktop app lives under **`web/src-tauri/`**: **Tauri v2** wraps the same Next.js UI.

**Sidecar** (`sidecar.rs`) starts and stops the Python backend and Next.js dev server as child processes so the native window loads the familiar web stack.

## Environment (optional)

- `HIAGENT_FRONTEND_PORT`
- `HIAGENT_BACKEND_PORT`
- `HIAGENT_PROJECT_DIR`

## Deeper documentation

[Desktop app guide](../desktop-app.md) — architecture diagram, packaging, troubleshooting.

## Related

- [Makefile commands](commands.md) (`make desktop`, `make build-desktop`)
