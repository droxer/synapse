import type { AgentEvent } from "@/shared/types";

export function getStableDataKey(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => getStableDataKey(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${getStableDataKey(record[key])}`)
    .join(",")}}`;
}

/** Fast-path key for high-frequency event types; falls back to deep serialization. */
export function getEventKey(event: AgentEvent): string {
  if (event.type === "text_delta") {
    return `text_delta|${event.timestamp}|${event.iteration ?? ""}|${(event.data as Record<string, unknown>).delta ?? ""}`;
  }
  if (event.type === "tool_call") {
    const data = event.data as Record<string, unknown>;
    const toolId = data.tool_id ?? data.id;
    if (toolId !== undefined && toolId !== null && String(toolId).trim()) {
      return [
        "tool_call",
        String(event.iteration ?? ""),
        String(toolId),
        String(data.tool_name ?? data.name ?? ""),
        getStableDataKey(data.tool_input ?? data.input ?? data.arguments ?? {}),
        String(data.agent_id ?? ""),
      ].join("|");
    }
  }
  if (event.type === "tool_result") {
    const data = event.data as Record<string, unknown>;
    const toolId = data.tool_id ?? data.id;
    if (toolId !== undefined && toolId !== null && String(toolId).trim()) {
      return [
        "tool_result",
        String(event.iteration ?? ""),
        String(toolId),
        getStableDataKey(data),
      ].join("|");
    }
  }
  return [
    event.type,
    String(event.timestamp),
    String(event.iteration ?? ""),
    getStableDataKey(event.data),
  ].join("|");
}

export function mergeUniqueEvents(
  historyEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
): AgentEvent[] {
  // Preserve causal order: persisted history order, then live SSE order.
  // Sorting by timestamp reorders the stream when the backend uses coarse or
  // non-monotonic timestamps (common in long tool-heavy turns), which shuffles
  // assistant segments (e.g. research steps vs findings).
  const seen = new Set<string>();
  const result: AgentEvent[] = [];

  for (const event of historyEvents) {
    const key = getEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  for (const event of liveEvents) {
    const key = getEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }

  return result;
}
