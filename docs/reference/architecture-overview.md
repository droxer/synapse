# Architecture overview

Synapse is a **full-stack AI agent framework**:

- **Backend**: Python, **FastAPI**, async SQLAlchemy, Anthropic client, optional sandboxes (Boxlite, E2B, local).
- **Frontend**: **Next.js 15** (App Router), React 19, Tailwind CSS 4, Turbopack.
- **Realtime**: **Server-Sent Events (SSE)** from the backend to the browser for agent events.

The agent runs a **ReAct-style loop** (LLM → tools → events) or a **planner mode** that decomposes work and spawns sub-agents. State is persisted to a database; optional channels (e.g. Telegram) reuse the same runtime with adapter layers.

## Deep dives

- [Backend layout](backend-layout.md)
- [Frontend layout](frontend-layout.md)
- [Chat data flow](data-flow-chat.md)
- [Channels data flow](data-flow-channels.md)
- [Desktop shell](desktop-shell.md)
- [Patterns](patterns.md)
- [Agent memory](../agent-memory-management.md)
