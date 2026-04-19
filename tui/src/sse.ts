import { toTimestampMs } from "./types.ts";
import type { ConversationEvent } from "./types.ts";

export interface SseFrame {
  readonly event: string;
  readonly data: string;
}

const EVENT_TYPE_SET = new Set<string>([
  "task_start",
  "task_complete",
  "task_error",
  "turn_start",
  "turn_complete",
  "turn_cancelled",
  "iteration_start",
  "iteration_complete",
  "llm_request",
  "llm_response",
  "text_delta",
  "tool_call",
  "tool_result",
  "message_user",
  "ask_user",
  "user_response",
  "agent_spawn",
  "agent_start",
  "agent_complete",
  "agent_handoff",
  "agent_stage_transition",
  "agent_skipped",
  "agent_replan_required",
  "thinking",
  "sandbox_stdout",
  "sandbox_stderr",
  "code_result",
  "artifact_created",
  "conversation_title",
  "skill_activated",
  "skill_setup_failed",
  "plan_created",
  "loop_guard_nudge",
  "planner_auto_selected",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventType(value: unknown): value is string {
  return typeof value === "string" && EVENT_TYPE_SET.has(value);
}

function coerceToolId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function normalizeEventText(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeEventData(
  eventType: string,
  raw: unknown,
): Record<string, unknown> {
  const data = isRecord(raw) ? { ...raw } : {};

  if (eventType === "text_delta") {
    return {
      ...data,
      delta: typeof data.delta === "string" ? data.delta : undefined,
      agent_id: typeof data.agent_id === "string" ? data.agent_id : undefined,
    };
  }

  if (eventType === "llm_response") {
    return {
      ...data,
      text: typeof data.text === "string" ? data.text : undefined,
      content: typeof data.content === "string" ? data.content : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
    };
  }

  if (eventType === "thinking") {
    return {
      ...data,
      thinking: typeof data.thinking === "string" ? data.thinking : undefined,
      text: typeof data.text === "string" ? data.text : undefined,
      content: typeof data.content === "string" ? data.content : undefined,
      duration_ms:
        typeof data.duration_ms === "number" ? data.duration_ms : undefined,
    };
  }

  if (eventType === "turn_start") {
    return {
      ...data,
      message: typeof data.message === "string" ? data.message : undefined,
      orchestrator_mode:
        data.orchestrator_mode === "agent" || data.orchestrator_mode === "planner"
          ? data.orchestrator_mode
          : undefined,
    };
  }

  if (eventType === "tool_call") {
    return {
      ...data,
      tool_id: coerceToolId(data.tool_id) ?? coerceToolId(data.id),
      id: coerceToolId(data.id),
      name: typeof data.name === "string" ? data.name : undefined,
      tool_name:
        typeof data.tool_name === "string" ? data.tool_name : undefined,
      input: isRecord(data.input) ? data.input : undefined,
      tool_input: isRecord(data.tool_input) ? data.tool_input : undefined,
      arguments: isRecord(data.arguments) ? data.arguments : undefined,
      agent_id: typeof data.agent_id === "string" ? data.agent_id : undefined,
    };
  }

  if (eventType === "tool_result") {
    return {
      ...data,
      tool_id: coerceToolId(data.tool_id) ?? coerceToolId(data.id),
      id: coerceToolId(data.id),
      output: normalizeEventText(data.output),
      result: normalizeEventText(data.result),
      success: typeof data.success === "boolean" ? data.success : undefined,
      content_type:
        typeof data.content_type === "string" ? data.content_type : undefined,
      artifact_ids: Array.isArray(data.artifact_ids)
        ? data.artifact_ids.filter((value): value is string => typeof value === "string")
        : undefined,
      agent_id: typeof data.agent_id === "string" ? data.agent_id : undefined,
      steps: typeof data.steps === "number" ? data.steps : undefined,
      is_done: typeof data.is_done === "boolean" ? data.is_done : undefined,
      max_steps: typeof data.max_steps === "number" ? data.max_steps : undefined,
      url: typeof data.url === "string" ? data.url : undefined,
      task: typeof data.task === "string" ? data.task : undefined,
      action: typeof data.action === "string" ? data.action : undefined,
      x: typeof data.x === "number" ? data.x : undefined,
      y: typeof data.y === "number" ? data.y : undefined,
      text: typeof data.text === "string" ? data.text : undefined,
      end_x: typeof data.end_x === "number" ? data.end_x : undefined,
      end_y: typeof data.end_y === "number" ? data.end_y : undefined,
      amount: typeof data.amount === "number" ? data.amount : undefined,
    };
  }

  if (eventType === "sandbox_stdout" || eventType === "sandbox_stderr") {
    return {
      ...data,
      text: normalizeEventText(data.text),
    };
  }

  return data;
}

export async function* iterLines(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        yield line;
        newlineIndex = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      yield buffer.replace(/\r$/, "");
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* iterSseMessages(
  lines: AsyncIterable<string>,
): AsyncIterable<SseFrame> {
  let event = "message";
  const dataLines: string[] = [];

  for await (const line of lines) {
    if (!line) {
      if (dataLines.length > 0) {
        yield {
          event,
          data: dataLines.join("\n"),
        };
      }
      event = "message";
      dataLines.length = 0;
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length > 0) {
    yield {
      event,
      data: dataLines.join("\n"),
    };
  }
}

export function parseAgentEvent(
  rawJson: string,
  fallbackEventType: string,
): ConversationEvent | null {
  const parsed: unknown = JSON.parse(rawJson);
  if (!isRecord(parsed)) {
    return null;
  }

  const eventType = isEventType(parsed.event_type)
    ? parsed.event_type
    : fallbackEventType;
  const dataPayload = isRecord(parsed.data) ? parsed.data : parsed;

  return {
    type: eventType,
    data: normalizeEventData(eventType, dataPayload),
    timestampMs: toTimestampMs(parsed.timestamp),
    iteration:
      typeof parsed.iteration === "number" ? parsed.iteration : null,
  };
}
