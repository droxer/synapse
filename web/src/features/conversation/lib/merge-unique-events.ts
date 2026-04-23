import type { AgentEvent } from "@/shared/types";

const APPROXIMATE_DUPLICATE_WINDOW_MS = 2_000;

export type UniqueEventSource = "history" | "live";

export interface UniqueEventDedupState {
  readonly seen: Set<string>;
  readonly approximateSeen: Map<
    string,
    Array<{ timestamp: number; source: UniqueEventSource }>
  >;
}

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeAttachmentFingerprint(attachments: unknown): string {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return "";
  }

  return attachments
    .filter((attachment): attachment is { name: string; size: number; type: string } =>
      Boolean(attachment)
      && typeof attachment === "object"
      && typeof attachment.name === "string"
      && typeof attachment.size === "number"
      && Number.isFinite(attachment.size)
      && typeof attachment.type === "string",
    )
    .map((attachment) => `${attachment.name}:${attachment.size}:${attachment.type}`)
    .sort()
    .join("|");
}

function getTurnStartFingerprint(event: Extract<AgentEvent, { type: "turn_start" }>): string {
  return [
    "turn_start",
    normalizeComparableText(String(event.data.message ?? "")),
    normalizeAttachmentFingerprint(event.data.attachments),
  ].join("|");
}

function getTerminalResultFingerprint(
  event: Extract<AgentEvent, { type: "turn_complete" | "task_complete" }>,
): string {
  const text = event.type === "task_complete"
    ? String(event.data.summary ?? event.data.result ?? "")
    : String(event.data.result ?? "");

  return [
    event.type,
    String(event.iteration ?? ""),
    normalizeComparableText(text),
  ].join("|");
}

export function getStableDataKey(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => getStableDataKey(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
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
  if (event.type === "turn_start") {
    return `${getTurnStartFingerprint(event)}|${event.timestamp}`;
  }
  if (event.type === "turn_complete" || event.type === "task_complete") {
    return `${getTerminalResultFingerprint(event)}|${event.timestamp}`;
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
  if (event.type === "turn_start") {
    return getTurnStartFingerprint(event);
  }
  if (event.type === "turn_complete" || event.type === "task_complete") {
    return getTerminalResultFingerprint(event);
  }

  return [
    event.type,
    String(event.iteration ?? ""),
    getStableDataKey(event.data),
  ].join("|");
}

export function createUniqueEventDedupState(): UniqueEventDedupState {
  return {
    seen: new Set<string>(),
    approximateSeen: new Map<
      string,
      Array<{ timestamp: number; source: UniqueEventSource }>
    >(),
  };
}

export function claimUniqueEvent(
  state: UniqueEventDedupState,
  event: AgentEvent,
  source: UniqueEventSource,
): boolean {
  const key = getEventKey(event);
  if (state.seen.has(key)) return false;

  const approximateFingerprint = getApproximateEventFingerprint(event);
  if (approximateFingerprint) {
    const entries = state.approximateSeen.get(approximateFingerprint) ?? [];
    const hasNearbyDuplicate = entries.some(
      ({ timestamp, source: seenSource }) =>
        Math.abs(timestamp - event.timestamp) <= APPROXIMATE_DUPLICATE_WINDOW_MS
        && (event.type !== "turn_start" || seenSource !== source),
    );
    if (hasNearbyDuplicate) {
      return false;
    }
    entries.push({ timestamp: event.timestamp, source });
    state.approximateSeen.set(approximateFingerprint, entries);
  }

  state.seen.add(key);
  return true;
}

export function mergeUniqueEvents(
  historyEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
): AgentEvent[] {
  // Preserve causal order: persisted history order, then live SSE order.
  // Sorting by timestamp reorders the stream when the backend uses coarse or
  // non-monotonic timestamps (common in long tool-heavy turns), which shuffles
  // assistant segments (e.g. research steps vs findings).
  const state = createUniqueEventDedupState();
  const result: AgentEvent[] = [];

  const appendEvent = (event: AgentEvent, source: UniqueEventSource) => {
    if (!claimUniqueEvent(state, event, source)) return;
    result.push(event);
  };

  for (const event of historyEvents) {
    appendEvent(event, "history");
  }
  for (const event of liveEvents) {
    appendEvent(event, "live");
  }

  return result;
}
