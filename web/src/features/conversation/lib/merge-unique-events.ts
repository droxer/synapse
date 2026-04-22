import type { AgentEvent } from "@/shared/types";

const APPROXIMATE_DUPLICATE_WINDOW_MS = 2_000;

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
    const data = event.data as Record<string, unknown>;
    const identityFields = [
      data.agent_id,
      data.turn_id,
      data.stream_id,
      data.chunk_id,
      data.sequence,
      data.index,
      data.offset,
      data.start,
      data.end,
    ];
    const hasExplicitChunkIdentity = identityFields.some(
      (value) => value !== undefined && value !== null && String(value).trim() !== "",
    );
    if (hasExplicitChunkIdentity) {
      return [
        "text_delta",
        String(event.iteration ?? ""),
        ...identityFields.map((value) => String(value ?? "")),
        String(data.delta ?? ""),
      ].join("|");
    }
    return `text_delta|${event.timestamp}|${event.iteration ?? ""}|${getStableDataKey(data)}`;
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

function getApproximateEventFingerprint(event: AgentEvent): string | null {
  if (event.type === "text_delta" || event.type === "tool_call" || event.type === "tool_result") {
    return null;
  }

  return [
    event.type,
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
  const approximateSeen = new Map<string, number[]>();
  const result: AgentEvent[] = [];

  const appendEvent = (event: AgentEvent) => {
    const key = getEventKey(event);
    if (seen.has(key)) return;

    const approximateFingerprint = getApproximateEventFingerprint(event);
    if (approximateFingerprint) {
      const timestamps = approximateSeen.get(approximateFingerprint) ?? [];
      const hasNearbyDuplicate = timestamps.some(
        (timestamp) => Math.abs(timestamp - event.timestamp) <= APPROXIMATE_DUPLICATE_WINDOW_MS,
      );
      if (hasNearbyDuplicate) {
        return;
      }
      timestamps.push(event.timestamp);
      approximateSeen.set(approximateFingerprint, timestamps);
    }

    seen.add(key);
    result.push(event);
  };

  for (const event of historyEvents) {
    appendEvent(event);
  }
  for (const event of liveEvents) {
    appendEvent(event);
  }

  return result;
}
