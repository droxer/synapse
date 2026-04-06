# Synapse agent memory management

**English** | [简体中文](zh-CN/agent-memory-management.md) · [All docs](README.md)

This document describes how Synapse handles **memory** in the broad sense: what stays in the LLM context window, what is persisted to the database, and how those pieces interact during a run, across reconnects, and in channel (e.g. Telegram) flows.

## Mental model: three related systems

| Layer | Purpose | Primary location |
| --- | --- | --- |
| **Working context** | Messages, tool I/O, and system prompt for the current turn | In-process `AgentState.messages` + assembled system prompt |
| **Context compaction** | Keeps estimated token usage under a budget by summarizing or truncating older content | `agent/runtime/observer.py` (`Observer`) |
| **Persistent memory** | Long-lived user data the agent can read/write across conversations | PostgreSQL/SQLite via `PersistentMemoryStore` (`agent/memory/store.py`) |

Additionally, **verified facts** (`memory_facts`) are a structured store used heavily in **channels** for retrieval-augmented prompt sections and optional background extraction.

---

## 1. Persistent key–value memory (`memory_entries`)

### Behavior

- **`PersistentMemoryStore`** (`agent/memory/store.py`) backs the agent-facing **memory_store**, **memory_search** (recall), and **memory_list** tools (`agent/tools/local/memory_*.py`).
- Entries are **scoped by authenticated user** (`user_id`). The optional `conversation_id` on each row is **provenance only**; listing and search are **not** filtered by conversation—everything visible belongs to the user across all their chats.
- If there is no authenticated user, `is_available` is false and tools fall back to in-memory behavior where applicable.

### System prompt injection

At conversation start (and when reconstructing from the DB), the backend loads up to 100 recent entries via `load_all()` and appends a `<personal_memory>` section via `build_agent_system_prompt()` in `api/builders.py`. The agent is told it can update memory with `memory_store`.

### HTTP API

- **`GET /api/memory`** — paginated browse (`api/routes/memory.py`).
- Deletes for individual entries are supported on the same router.

### Schema

Defined in `agent/memory/models.py` as `MemoryEntry` (table `memory_entries`). Migrations began with `005_add_memory_entries_table.py` and later added `user_id` and FK constraints.

---

## 2. Verified facts (`memory_facts`)

This is a **separate** table from `memory_entries`, optimized for **structured facts** with confidence, status (`active` / `stale`), and source metadata.

### Allowed namespaces and validation

`agent/memory/facts.py` defines:

- **Namespaces** accepted for automated ingestion: `profile`, `preferences`, `constraints`, `decisions`.
- **Rejection rules**: low confidence, empty key/value, suspected **secrets** (e.g. password, API key patterns), and **ephemeral** phrasing (e.g. “today”, “right now”).
- **`normalize_fact_key`**: keys are normalized and prefixed with the namespace.

### How facts get in

1. **Channels (Telegram, etc.)** — After a channel message is handled, the pipeline can run fact extraction and `upsert_fact` (see `api/routes/channels.py`). Idempotency per turn uses `MemoryFactIngestion` (`mark_fact_ingestion_seen`) so the same provider message is not processed twice.
2. **Compaction-time heuristic flush (optional)** — If `COMPACT_MEMORY_FLUSH` is enabled, the orchestrator calls `flush_heuristic_facts_from_messages()` (`agent/memory/compaction_flush.py`) **before** compaction. It scans **user** message text with `extract_fact_candidates()` (`agent/memory/heuristic_extract.py`)—currently pattern-based (e.g. “timezone is …”, “I prefer …”, “my language is …”)—and upserts validated facts.

### How facts are used

- For channel turns, `retrieve_relevant_facts()` matches the incoming message text (substring) against active facts, then `format_verified_facts_prompt_section()` adds a bounded `<verified_user_facts>` block (`MEMORY_FACT_TOP_K`, `MEMORY_FACT_PROMPT_TOKEN_CAP`).

`memory_entries` prompt injection and `memory_facts` sections are **independent**; channels may use both `load_all()` for personal memory and fact retrieval for the current message.

---

## 3. Context compaction (`Observer`)

**File:** `agent/runtime/observer.py`

### When it runs

- **`should_compact`**: true when a **fast heuristic** token estimate for `json.dumps(messages)` plus the system prompt exceeds **`COMPACT_TOKEN_BUDGET`**.
- **Token estimator**: `COMPACT_TOKEN_COUNTER` — `weighted` (CJK-aware) or `legacy` (~chars/4).

### What it does

Compaction returns a **new** message tuple; inputs are never mutated.

1. **First user message** (original task) is kept verbatim when possible.
2. **Tool-heavy threads**: recent tool interaction pairs are kept in full (**hot tier**); older regions are summarized (**warm tier**) with a small LLM call (`COMPACT_SUMMARY_MODEL` or `LITE_MODEL`), or fall back to structured truncation of tool results (`COMPACT_FALLBACK_PREVIEW_CHARS`, `COMPACT_FALLBACK_RESULT_CHARS`).
3. **Pure dialogue** (e.g. DB replay without tool blocks): older turns are summarized into a synthetic assistant message starting with `## Earlier conversation` or `## Previous work`, or truncated per `COMPACT_DIALOGUE_FALLBACK_CHARS` if summarization is unavailable.

### Where it is invoked

- **`AgentOrchestrator`** — main ReAct loop (`agent/runtime/orchestrator.py`). Optionally runs **heuristic fact flush** before compacting when `COMPACT_MEMORY_FLUSH` is true and a `PersistentMemoryStore` is present.
- **`TaskRunner`** — spawned sub-agents (`agent/runtime/task_runner.py`).
- **`Planner`** — planning mode (`agent/runtime/planner.py`).
- **`_reconstruct_conversation`** — when an SSE client reconnects and the conversation was evicted from memory (`api/routes/conversations.py`): rebuilt messages may be compacted again before the orchestrator runs.

### Events and metrics

- Each compaction emits **`CONTEXT_COMPACTED`** with metadata including `summary_text` when dialogue-style summaries exist (`compaction_summary_for_persistence()`).
- Sub-agent runs expose **`context_compaction_count`** in metrics.

---

## 4. Rolling `context_summary` on conversations

**Column:** `conversations.context_summary` (migration `020_add_conversation_context_summary.py`)

### Persistence path

When the DB subscriber handles **`CONTEXT_COMPACTED`** (`api/db_subscriber.py`), if `summary_text` is present it calls **`merge_conversation_context_summary`**: append the new fragment with a `---` separator, then **keep only the last `COMPACT_CONTEXT_SUMMARY_MAX_CHARS`** characters (rolling tail).

### Reconnect / cold start

When reconstructing from the DB (`_reconstruct_conversation` in `api/routes/conversations.py`):

- If `context_summary` is non-empty, only the **last `COMPACT_RECONSTRUCT_TAIL_MESSAGES`** messages are loaded from `messages` instead of the full history.
- An initial synthetic assistant message is prepended: `## Earlier sessions (compressed)` + the stored summary.

That gives the model a **compressed backbone** of older work plus recent verbatim messages, without reloading the entire thread.

---

## 5. Configuration reference

| Variable | Role |
| --- | --- |
| `COMPACT_TOKEN_BUDGET` | Estimated tokens above which compaction runs |
| `COMPACT_TOKEN_COUNTER` | `weighted` or `legacy` estimator |
| `COMPACT_FULL_INTERACTIONS` | Hot tier size for tool interactions |
| `COMPACT_FULL_DIALOGUE_TURNS` | Hot tier for dialogue-style threads |
| `COMPACT_SUMMARY_MODEL` | Model for warm-tier summaries (default: `LITE_MODEL`) |
| `COMPACT_FALLBACK_PREVIEW_CHARS` / `COMPACT_FALLBACK_RESULT_CHARS` | Tool-result fallback truncation |
| `COMPACT_DIALOGUE_FALLBACK_CHARS` | Dialogue fallback when summarizer unavailable |
| `COMPACT_CONTEXT_SUMMARY_MAX_CHARS` | Max rolling length for `context_summary` |
| `COMPACT_RECONSTRUCT_TAIL_MESSAGES` | Recent DB messages to load when `context_summary` exists |
| `COMPACT_MEMORY_FLUSH` | If true, run heuristic fact extraction from user text before orchestrator compaction |
| `MEMORY_FACT_CONFIDENCE_THRESHOLD` | Minimum confidence for accepting a fact candidate |
| `MEMORY_FACT_TOP_K` | Max facts injected for a channel message |
| `MEMORY_FACT_PROMPT_TOKEN_CAP` | Character cap on the verified-facts prompt section |

Environment defaults live in `backend/config/settings.py`; see `backend/.env.example` for documented env names.

---

## 6. File map

| Area | Path |
| --- | --- |
| KV store API | `agent/memory/store.py` |
| ORM models | `agent/memory/models.py` |
| Fact validation | `agent/memory/facts.py` |
| Heuristic extraction | `agent/memory/heuristic_extract.py` |
| Pre-compaction flush | `agent/memory/compaction_flush.py` |
| Compaction | `agent/runtime/observer.py` |
| Orchestrator integration | `agent/runtime/orchestrator.py` |
| System prompt + facts formatting | `api/builders.py` |
| DB merge for summaries | `agent/state/repository.py` → `merge_conversation_context_summary` |
| Event persistence | `api/db_subscriber.py` |
| Reconstruct + memory load | `api/routes/conversations.py` |
| Channel fact retrieval / extraction | `api/routes/channels.py` |
| Memory HTTP API | `api/routes/memory.py` |

---

## 7. Operational notes

- **Anonymous sessions**: persistent memory requires a user id; unauthenticated deployments will not persist KV memory or facts through `PersistentMemoryStore` in the same way.
- **Compaction tokens are heuristic**: they approximate “should we compact?” and are not billing-grade token counts.
- **Facts vs KV memory**: use **tools** for explicit, agent-controlled notes (`memory_entries`); **facts** are for validated, often channel-driven profile/preferences-style data with confidence and staleness semantics.

For deeper design history on Telegram memory compression, see `docs/superpowers/specs/2026-04-02-telegram-long-term-memory-compression-design.md`.
