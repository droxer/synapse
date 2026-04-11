import type { AgentEvent } from "@/shared/types";

export function getLatestTurnMode(events: AgentEvent[]): "agent" | "planner" | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== "turn_start") continue;
    const mode = event.data.orchestrator_mode;
    if (mode === "agent" || mode === "planner") {
      return mode;
    }
    break;
  }
  return null;
}

/**
 * Returns true if the current turn's planner mode was chosen automatically
 * by the complexity classifier (not manually toggled by the user).
 * Looks for a `planner_auto_selected` event just before the latest `turn_start`.
 */
export function getIsCurrentTurnAutoDetected(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== "turn_start") continue;
    // Scan up to 5 events before this turn_start (conversation_title may appear in between)
    for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
      if (events[j]?.type === "planner_auto_selected") return true;
      if (events[j]?.type === "turn_start") break;
    }
    return false;
  }
  return false;
}
