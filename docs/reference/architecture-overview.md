# Architecture overview

Synapse is a **full-stack AI agent framework**:

- **Backend**: Python, **FastAPI**, async SQLAlchemy, Anthropic client, sandbox providers selected by the runtime builder (`boxlite` or `e2b` in the current configuration path).
- **Frontend**: **Next.js 16** (App Router), React 19, Tailwind CSS 4, Turbopack.
- **Realtime**: **Server-Sent Events (SSE)** from the backend to the browser for agent events.

At runtime, each conversation turn is routed into one of two orchestration modes:

- **Single-agent execution**: a ReAct-style loop (`LLM -> tools -> events -> repeat`) handled by `AgentOrchestrator`
- **Planner execution**: a planner loop that declares steps, spawns task agents, waits for results, and synthesizes the final answer via `PlannerOrchestrator`

The conversation route can force planner mode via `use_planner`; when the flag is unset, the backend classifies the turn into an execution shape and maps that to either single-agent or planner orchestration.

## Core runtime pieces

- **Conversation bootstrap**: `api/routes/conversations.py` resolves the user, loads persistent memory, restores user MCP servers in the background, builds a user-scoped skill registry, and constructs the orchestrator/tool executor pair.
- **Prompt assembly**: system prompts are built in `api/builders.py` from the default/planner prompt, optional memory sections, and the visible skill catalog.
- **Tool execution**: `ToolExecutor` routes local tools directly and creates sandbox sessions lazily for sandbox tools, keyed by template so browser workloads can run in a browser-capable sandbox.
- **Skills**: skills are `SKILL.md` packages discovered from bundled, user, and optionally project paths. Selection is explicit first, then model-driven, then keyword fallback.
- **Memory**: Synapse keeps working context in process, injects persistent user memory into prompts, and compacts long threads using runtime-specific profiles. Channel flows can also inject verified facts.
- **Frontend agent UX**: the web app derives messages, plan steps, tool calls, artifacts, thinking blocks, and sub-agent status directly from the SSE event stream.

## Runtime surfaces

- **Web conversations**: main chat UI with uploads, skill selection, tool streaming, artifact previews, and reconnect logic
- **Planner/task agents**: explicit plan declarations, worker spawn/wait, per-agent metrics, and failure propagation
- **Channels**: reuse the same runtime with channel-specific adapters, responder logic, and fact retrieval
- **Desktop shell**: wraps the same web UI and backend/frontend services in a Tauri shell

## Deep dives

- [Backend layout](backend-layout.md)
- [Frontend layout](frontend-layout.md)
- [Chat data flow](data-flow-chat.md)
- [Channels data flow](data-flow-channels.md)
- [Desktop shell](desktop-shell.md)
- [Patterns](patterns.md)
- [Agent memory](../agent-memory-management.md)
