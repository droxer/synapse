# Data flow: channels (e.g. Telegram)

1. User links a Telegram account via bot configuration → backend issues webhook secret.
2. User messages the bot → provider webhook → backend creates or resumes conversation/session.
3. Backend runs the same **ReAct** (or planner) loop as web chat against the channel text (and attachments when supported).
4. Assistant text is sent back through **`ChannelResponder`** as channel messages.
5. Web UI shows channel threads in a **split panel** (list + isolated chat view with its own SSE).

Channel chat views keep **their own** SSE, history merge, and state — they do not depend on the global conversation store.

## Logs: skill selection (channels and web)

Channel sessions use the same runtime as web chat, including **LLM-driven skill selection** (`agent.runtime.skill_selector`) when the user did not pin an explicit skill.

You may see:

```text
WARNING ... skill_selector_model_error error=Expecting value: line 1 column 1 (char 0), falling back to keyword
```

**What it means:** The selector asked the model for JSON (`{"skill": "<name>"}` or `{"skill": null}`), but nothing could be parsed after normalisation — for example an empty/whitespace-only assistant string, or content with no JSON object at all. The parser accepts a leading UTF-8 BOM, prose before the first `{`, and Markdown code fences around the object. Some hosted endpoints still return HTTP 200 for unusable bodies.

**Impact:** The runtime **falls back to keyword matching** on skill descriptions (`skill_selector_keyword_fallback` in logs when a match exists). Replies still complete; only automatic skill choice may differ from what a JSON-obedient model would pick.

**If it is noisy or skill choice matters:** Pin skills explicitly for that channel or user, or use a model/provider that reliably returns JSON for short structured outputs.

## Related

- [Backend layout](backend-layout.md) (`api/channels/`, `channels.py` route)
- [Frontend layout](frontend-layout.md) (`src/features/channels/`)
- [Patterns](patterns.md)
- [Agent memory](../agent-memory-management.md) (facts and persistence in channel flows)
