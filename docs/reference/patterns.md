# Key engineering patterns

## Immutability

Frozen **dataclasses** and immutable updates in core agent code (`AgentState`, `ToolResult`, `SkillMetadata`, `LLMResponse`, `ChannelConversationRecord`, channel DTOs).

## Event-driven UI

**`EventEmitter`** pub/sub connects the agent loop to the SSE stream so the API layer can fan out the same events to subscribers (HTTP SSE, DB persistence, channels).

## Execution routing

Conversation turns are routed before runtime construction. `use_planner` is a hard override; otherwise the backend classifies the turn into an execution shape (`single_agent`, `prompt_chain`, `parallel`, `orchestrator_workers`) and maps that to single-agent or planner orchestration.

## Tool registry

Tools register into an **immutable** registry; execution resolves by name through `ToolExecutor`. The executor handles local-vs-sandbox routing, lazy sandbox session creation, per-turn tool allowlists, and artifact capture.

## Skills

**LLM-driven skill selection**: explicit skill name → attachment-aware/model pick → keyword fallback. The chosen skill injects methodology into the orchestrator prompt, can restrict tool access, can request dependency installation, and can switch the sandbox template for the turn.

## Memory layering

Synapse keeps three related memory layers:

- working turn context in the in-process message chain
- prompt compaction to keep long threads under budget
- persistent user memory and verified facts loaded into prompt sections when available

## Agent naming

Spawned sub-agents get human-friendly names via **`spawn_task_agent`**.

## Channel isolation

Channel UIs manage **local** SSE and history; they avoid coupling to the global app store used by the main web conversation.

## Related

- [Architecture overview](architecture-overview.md)
- [Backend layout](backend-layout.md)
- [Python style](style-python.md)
