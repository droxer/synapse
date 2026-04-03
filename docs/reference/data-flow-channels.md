# Data flow: channels (e.g. Telegram)

1. User links a Telegram account via bot configuration → backend issues webhook secret.
2. User messages the bot → provider webhook → backend creates or resumes conversation/session.
3. Backend runs the same **ReAct** (or planner) loop as web chat against the channel text (and attachments when supported).
4. Assistant text is sent back through **`ChannelResponder`** as channel messages.
5. Web UI shows channel threads in a **split panel** (list + isolated chat view with its own SSE).

Channel chat views keep **their own** SSE, history merge, and state — they do not depend on the global conversation store.

## Related

- [Backend layout](backend-layout.md) (`api/channels/`, `channels.py` route)
- [Frontend layout](frontend-layout.md) (`src/features/channels/`)
- [Patterns](patterns.md)
- [Agent memory](../agent-memory-management.md) (facts and persistence in channel flows)
