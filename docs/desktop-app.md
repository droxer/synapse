# Synapse Desktop App

Synapse Desktop wraps the existing web frontend in a [Tauri v2](https://v2.tauri.app/) native shell, giving you a standalone macOS/Windows/Linux application with no browser tab required.

## Architecture

```
┌──────────────────────────────────┐
│         Tauri Desktop Shell      │
│  ┌────────────────────────────┐  │
│  │   WKWebView / WebView2    │  │
│  │   (loads configured web UI)│  │
│  └────────────┬───────────────┘  │
│               │                  │
│  ┌────────────▼───────────────┐  │
│  │   Desktop Bootstrap        │  │
│  │   (Rust / tokio)           │  │
│  └──────┬────────────┬────────┘  │
│         │            │           │
│    ┌────▼────┐  ┌────▼────┐     │
│    │ Synapse │  │ Synapse │     │
│    │ Web     │  │ API     │     │
│    └─────────┘  └─────────┘     │
└──────────────────────────────────┘
```

The desktop shell has two runtime modes:

- **Dev**: Tauri starts the local Next.js dev server and Python backend from the repo checkout.
- **Release**: the packaged app connects only to explicitly configured Synapse frontend/backend URLs.
- In both modes, the app attaches only to services that pass Synapse-specific health checks.

## Prerequisites

- **Rust** 1.77+ (`rustup` or Homebrew)
- **Node.js** with npm
- **Python 3.12+** with `uv`
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)

## Quick Start

```bash
# Dev mode — opens Tauri window with hot reload
make desktop

# Production build — creates .app bundle
make build-desktop
```

The production `.app` is output to:

```
web/src-tauri/target/release/bundle/macos/Synapse.app
```

## Configuration

### Dev mode (`make desktop`)

Dev mode starts local services from the repo checkout.

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNAPSE_FRONTEND_PORT` | `3000` | Port for the Next.js frontend |
| `SYNAPSE_BACKEND_PORT` | `8000` | Port for the Python backend |
| `SYNAPSE_PROJECT_DIR` | auto-detected | Path to the Synapse repo root |

### Custom ports

```bash
SYNAPSE_FRONTEND_PORT=4000 SYNAPSE_BACKEND_PORT=9000 make desktop
```

### Release mode (`make build-desktop`)

Release builds do not start local `npm run dev` or `uv run` processes. The packaged app requires explicit Synapse service URLs:

| Variable | Description |
|----------|-------------|
| `SYNAPSE_FRONTEND_URL` | Required URL for the hosted Synapse frontend |
| `SYNAPSE_BACKEND_URL` | Required URL for the hosted Synapse backend |

The desktop shell validates:

- `GET {SYNAPSE_FRONTEND_URL}/api/desktop/health` returns `service: "synapse-web"`
- `GET {SYNAPSE_BACKEND_URL}/health` returns `service: "synapse-api"`

### Backend environment

The backend still reads its own `.env` file from `backend/.env`. See `backend/.env.example` for required variables (`ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, etc.).

## Google OAuth (System Browser)

The desktop app opens Google OAuth in the **system browser** instead of the embedded webview. This is required because Google blocks OAuth in embedded webviews.

### Flow

1. User clicks "Sign in with Google" in the Tauri window
2. `isTauri()` detects desktop mode (via `?desktop=1` URL param or localStorage flag)
3. A unique **nonce** is generated and the system browser opens via the `open_url` Tauri command (uses the `open` crate)
4. System browser loads `/login?fromDesktop=1&nonce=xxx` → auto-triggers `signIn("google")`
5. Google OAuth completes → NextAuth redirects to `/auth/desktop-callback?nonce=xxx`
6. Callback page reads the NextAuth session, POSTs user data to `/api/auth/desktop-token` keyed by the nonce
7. Tauri webview polls `/api/auth/desktop-token?nonce=xxx` (1s interval, up to 2 min)
8. When the token is available, the webview calls `signIn("desktop-token", ...)` to create its own NextAuth session
9. Webview reloads to `/` with an active session

### Desktop Token Exchange

The token exchange uses an in-memory store on the Next.js server:

- `POST /api/auth/desktop-token` — Store user data under a nonce (called by browser callback page)
- `GET /api/auth/desktop-token?nonce=xxx` — Retrieve and delete user data (called by Tauri webview)

Tokens are short-lived (120s) and single-use. A `desktop-token` NextAuth Credentials provider creates a proper JWT session in the webview context.

### Desktop Mode Detection

`isTauri()` in `src/lib/tauri.ts` uses a 3-layer detection strategy:

1. **Primary**: `window.__TAURI_INTERNALS__` (available when `withGlobalTauri: true`)
2. **Fallback 1**: `?desktop=1` URL parameter (passed from the Tauri loading page through middleware redirects)
3. **Fallback 2**: `localStorage.getItem("synapse-desktop")` (persisted by `DesktopModeDetector` in providers)

### Setup

Your Google OAuth credentials need `http://localhost:3000/api/auth/callback/google` (or your custom port) as an authorized redirect URI in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

The `/auth/desktop-callback` route is excluded from auth middleware in `proxy.ts` so the browser can access it after OAuth without a session in the webview.

## Project Structure

```
web/
├── src-tauri/                          # Tauri desktop shell
│   ├── Cargo.toml                      # Rust dependencies (tauri, open, reqwest, tokio)
│   ├── build.rs                        # Tauri build script
│   ├── tauri.conf.json                 # Window, CSP, plugins, bundle config
│   ├── capabilities/
│   │   └── default.json                # Permissions (shell, deep-link, devtools)
│   ├── icons/                          # App icons (32, 128, 128@2x, icns, ico)
│   └── src/
│       ├── main.rs                     # Entry point
│       ├── lib.rs                      # Tauri setup, commands (open_url, get_frontend_url)
│       ├── config.rs                   # Dev/release bootstrap config
│       └── sidecar.rs                  # Service probes + dev sidecar manager
├── dist/
│   └── index.html                      # Loading screen (polls until frontend ready)
├── src/
│   ├── lib/
│   │   ├── tauri.ts                    # isTauri(), openInSystemBrowser(), getFrontendUrl()
│   │   └── auth.ts                     # NextAuth config (Google + desktop-token providers)
│   ├── app/
│   │   ├── api/desktop/health/
│   │   │   └── route.ts               # Frontend identity health endpoint
│   │   ├── providers.tsx               # DesktopModeDetector component
│   │   ├── auth/desktop-callback/
│   │   │   └── page.tsx                # Browser OAuth callback → token handoff
│   │   ├── api/auth/desktop-token/
│   │   │   └── route.ts               # Token exchange API (nonce-based, in-memory)
│   │   └── login/page.tsx              # Login with desktop polling support
│   └── proxy.ts                        # Middleware (desktop flag + callback exclusions)
└── package.json                        # Includes tauri:dev and tauri:build scripts
```

## Makefile Targets

| Target | Description |
|--------|-------------|
| `make desktop` | Start Tauri in dev mode |
| `make build-desktop` | Build production `.app` bundle |

## Tauri Commands (Rust → JS)

| Command | Description |
|---------|-------------|
| `open_url` | Open a URL in the system browser (uses `open` crate) |
| `get_frontend_url` | Return the configured frontend URL |
| `get_sidecar_status` | Check if sidecars are running |

## Troubleshooting

### Port already in use

Dev mode reuses an existing local service only when it passes the Synapse health probe. If another process is listening on the configured port, the desktop app fails closed instead of attaching to that service.

### Backend fails to start in dev

Check that `backend/.env` exists with valid API keys. You can also start the backend manually and let the desktop app detect it:

```bash
make backend &
make desktop
```

### DMG bundling fails

The DMG bundler requires `create-dmg`. Install it or stick with the `.app` output:

```bash
brew install create-dmg
```

The bundle target is set to `app` only by default. To enable DMG, change `targets` in `tauri.conf.json`:

```json
"targets": ["app", "dmg"]
```

### OAuth redirect mismatch

Ensure your Google OAuth client has `http://localhost:<SYNAPSE_FRONTEND_PORT>/api/auth/callback/google` as an authorized redirect URI.

For release builds, `SYNAPSE_FRONTEND_URL` must point at a deployment whose OAuth configuration already matches that hosted frontend.

### System browser doesn't open for OAuth

The `open_url` Tauri command uses the `open` crate which calls the OS default browser. If the Tauri shell plugin is blocked by ACL, it falls through to this command automatically. Check the Tauri dev console for `[tauri] invoke open_url failed` errors.

### Auth callback page shows error

The `/auth/desktop-callback` page must be accessible without authentication. Verify `proxy.ts` has the `isDesktopCallback` exclusion check.

### Release app shows a configuration error

Set both `SYNAPSE_FRONTEND_URL` and `SYNAPSE_BACKEND_URL` before launching the packaged app. The desktop shell refuses to boot if either URL is missing, unavailable, or does not identify itself as Synapse.
