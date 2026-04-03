# Data flow: web chat

1. User sends a message → frontend **POST** `/api/conversations` (optional **planner** mode).
2. Frontend opens **SSE** to `/api/conversations/{id}/events`.
3. **Planner mode**: backend `plan_create` → steps → concurrent sub-agents → completion.
4. **Default mode**: **ReAct** loop — LLM call → tool execution → events → repeat until done.
5. UI renders SSE events live (messages, timeline, tool output, sub-agents).

## Related

- [Architecture overview](architecture-overview.md)
- [Backend layout](backend-layout.md)
- [Patterns](patterns.md)
