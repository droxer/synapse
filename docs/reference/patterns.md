# Key engineering patterns

## Immutability

Frozen **dataclasses** and immutable updates in core agent code (`AgentState`, `ToolResult`, `SkillMetadata`, `LLMResponse`, `ChannelConversationRecord`, channel DTOs).

## Event-driven UI

**`EventEmitter`** pub/sub connects the agent loop to the SSE stream so the API layer can fan out the same events to subscribers (HTTP SSE, DB persistence, channels).

## Tool registry

Tools register at startup into an **immutable** registry; execution resolves by name.

## Skills

**LLM-driven skill selection**: explicit skill name → model pick → keyword fallback. The chosen skill injects methodology into the orchestrator prompt (not only tool names).

## Agent naming

Spawned sub-agents get human-friendly names via **`spawn_task_agent`**.

## Channel isolation

Channel UIs manage **local** SSE and history; they avoid coupling to the global app store used by the main web conversation.

## Related

- [Architecture overview](architecture-overview.md)
- [Backend layout](backend-layout.md)
- [Python style](style-python.md)
