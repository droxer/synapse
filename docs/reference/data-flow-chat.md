# Data flow: web chat

1. User sends a message from the chat UI → frontend **POST** `/api/conversations`.
2. The request may include `use_planner`:
   - `true` forces planner orchestration
   - `false` forces single-agent execution
   - unset lets the backend classify the turn into an execution shape
3. The backend prepares runtime inputs for the conversation:
   - resolves the authenticated user
   - loads persistent memory entries for prompt injection
   - builds a user-scoped skill registry from the global registry plus DB visibility
   - schedules user MCP restoration in the background when needed
4. Frontend opens **SSE** to `/api/conversations/{id}/events`.
5. The backend runs one of two orchestrators:
   - **Single-agent**: `AgentOrchestrator` executes the ReAct loop (`LLM -> tools -> events -> repeat`)
   - **Planner**: `PlannerOrchestrator` declares steps, spawns task agents, waits, and synthesizes the result
6. Tool calls, assistant output, plan steps, thinking, artifacts, and agent status stream over SSE and are rendered live by the conversation and agent-computer UI.
7. If a client reconnects after in-memory eviction, the backend reconstructs the conversation from DB history and any persisted `context_summary`, then resumes streaming from the rebuilt runtime.

## Related

- [Architecture overview](architecture-overview.md)
- [Backend layout](backend-layout.md)
- [Patterns](patterns.md)
