# Agent Handoff Design

**Date:** 2026-03-19
**Status:** Approved

## Overview

Add agent-initiated handoff capability to HiAgent's multi-agent system. A sub-agent can hand off control to a new specialist agent mid-execution, transferring its conversation history and context. The planner is unaware of handoffs — they are internal to the SubAgentManager.

## Motivation

Currently, sub-agents must complete their task or fail. There's no way for an agent to recognize that a different specialization is needed and delegate accordingly. Handoff enables dynamic agent chaining: a coder can hand off to a reviewer, a researcher to an implementer, etc.

## Tool Interface

New `agent_handoff` tool, available to sub-agents only (not the planner):

```python
agent_handoff(
    target_role: str,           # Required — role for the new agent
    task_description: str,      # Required — what the new agent should do
    context: str = "",          # Optional — handoff notes
)
```

**Behavior:**
- Stops the current agent immediately (like `task_complete`)
- Triggers a new agent with the old agent's conversation history + handoff context
- The calling agent terminates after handoff
- `agent_wait` transparently waits for the final agent in the chain

## Data Model

### New: `HandoffRequest` (frozen dataclass, in `task_runner.py`)

```python
@dataclass(frozen=True)
class HandoffRequest:
    target_role: str
    task_description: str
    context: str
    source_messages: tuple[dict, ...]
    remaining_handoffs: int
```

### Modified: `TaskAgentConfig`

Add one field:
```python
max_handoffs: int = 3
```

Decremented on each handoff. When 0, the `agent_handoff` tool returns an error telling the agent to use `task_complete` instead.

## Internal Flow

### 1. Agent calls `agent_handoff`

The tool sets `_handoff_request` on the runner via callback (same pattern as `task_complete` setting `_task_complete_summary`). The tool processing loop stops immediately.

### 2. TaskAgentRunner returns with handoff

The runner's `run()` method returns an `AgentResult` with a `handoff` field set to the `HandoffRequest`. This is a new optional field on `AgentResult`.

### 3. SubAgentManager handles the handoff

In `_run_agent()`, after the runner returns:
- If `result.handoff` is `None` → normal path, store result
- If `result.handoff` is set → spawn replacement agent inline:
  - `task_description` from handoff request
  - `context` = formatted old agent messages + handoff context string
  - `role` = `target_role`
  - `max_handoffs` = old value minus 1
- The replacement's asyncio Task **replaces** the original in `self._agents[agent_id]` (same key)
- `agent_wait` sees no difference — it waits on the same key and gets the final result

### 4. Planner is unaware

The planner calls `agent_wait(agent_ids)` and gets back the final agent's result under the original agent ID. No changes to planner, spawn, or wait tools.

## Transfer Semantics

**Context-only transfer:**
- New agent gets old agent's conversation history (messages) and handoff context string
- Fresh sandbox session — no shared mutable state
- Conversation history already contains tool call results (code output, file contents)
- Preserves the immutable/isolated design pattern

## Chain Bounding

- Default max 3 handoffs per original agent spawn
- Each handoff decrements `remaining_handoffs`
- When `remaining_handoffs == 0`, `agent_handoff` tool returns an error
- Prevents infinite loops (A → B → A → B → ...)

## Event Emission

New event type `AGENT_HANDOFF`:

```json
{
    "type": "agent_handoff",
    "data": {
        "source_agent_id": "uuid-of-old-agent",
        "target_agent_id": "uuid-of-new-agent",
        "parent_agent_id": "uuid-original",
        "target_role": "reviewer",
        "reason": "Code is complete, needs security review",
        "handoff_depth": 2,
        "remaining_handoffs": 1
    }
}
```

**Frontend rendering:** Handoffs appear as steps within the existing `AgentProgressCard` for the original agent ID — not as separate agent cards.

## Files to Modify

| File | Change |
|---|---|
| `agent/runtime/task_runner.py` | Add `HandoffRequest`, `max_handoffs` to config, handoff callback in loop |
| `agent/runtime/sub_agent_manager.py` | Handle handoff in `_run_agent()` — spawn replacement, swap task |
| `agent/tools/meta/handoff.py` | **New** — `AgentHandoff` tool |
| `agent/tools/meta/__init__.py` | Export `AgentHandoff` |
| `api/builders.py` | Register `AgentHandoff` in sub-agent registry factory |
| `shared/types/events.ts` | Add `agent_handoff` event type |
| `features/agent-computer/hooks/use-agent-state.ts` | Handle handoff events as steps |
| `features/agent-computer/AgentProgressCard.tsx` | Render handoff step in timeline |

## Files NOT Modified

- `planner.py` — planner is unaware of handoffs
- `spawn_task_agent.py` / `wait_for_agents.py` — no changes
- `task_complete.py` — unchanged, handoff is a parallel signal path

## Design Decisions

1. **Agent-initiated (not planner-mediated):** Simplest model, fits naturally as a tool, proven by OpenAI Swarm
2. **Context-only transfer (no sandbox inheritance):** Preserves immutable/isolated design, no shared mutable state
3. **Bounded chains (max 3):** Prevents runaway loops, configurable per spawn
4. **Transparent to planner:** Same agent_id key, `agent_wait` unmodified
5. **Event-based observability:** Frontend sees handoffs via events, rendered as steps in existing cards
