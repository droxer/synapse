import type { AgentEvent, ChatMessage, TaskState } from "@/shared/types";

export function getCurrentTurnEventSlice(events: readonly AgentEvent[]): readonly AgentEvent[] {
  let lastCompleteIdx = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type === "turn_complete") {
      lastCompleteIdx = i;
    }
  }
  if (lastCompleteIdx === -1) return events;
  return events.slice(lastCompleteIdx + 1);
}

export function hasPlannerSignalsSinceLastTurnComplete(events: readonly AgentEvent[]): boolean {
  return getCurrentTurnEventSlice(events).some((e) => e.type === "plan_created");
}

export function getPlanMessageIndex(
  events: readonly AgentEvent[],
  messages: readonly ChatMessage[],
): number | null {
  let planEventIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === "plan_created") {
      planEventIdx = i;
      break;
    }
  }
  if (planEventIdx === -1) return null;

  const planEvent = events[planEventIdx]!;
  let turnStartTimestamp = Number.NEGATIVE_INFINITY;
  for (let i = planEventIdx; i >= 0; i--) {
    if (events[i]?.type === "turn_start") {
      turnStartTimestamp = events[i]!.timestamp;
      break;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message?.role === "assistant"
      && message.timestamp >= turnStartTimestamp
      && message.timestamp <= planEvent.timestamp
    ) {
      return i;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role === "assistant" && message.timestamp >= turnStartTimestamp) {
      return i;
    }
  }

  return null;
}

export interface PlannerModeBadgeContext {
  readonly taskState: TaskState;
  readonly isWaitingForAgent: boolean;
  readonly plannerBadgeLive: boolean;
  readonly explicitPlannerPending: boolean;
}

export function shouldShowPlannerModeBadge(
  events: readonly AgentEvent[],
  ctx: PlannerModeBadgeContext,
): boolean {
  if (ctx.taskState === "planning") return true;
  if (!ctx.plannerBadgeLive) return false;
  if (ctx.taskState === "executing" && hasPlannerSignalsSinceLastTurnComplete(events)) {
    return true;
  }
  return false;
}

export function getLatestTurnMode(events: readonly AgentEvent[]): "agent" | "planner" | null {
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
export function getIsCurrentTurnAutoDetected(events: readonly AgentEvent[]): boolean {
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
