"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { EVENT_TYPES } from "@/shared/types";
import type {
  AgentEvent,
  AgentEventDataByType,
  EventType,
} from "@/shared/types";
import { API_BASE, MAX_RETRIES, BASE_DELAY_MS, MAX_DELAY_MS } from "@/shared/constants";

const SSE_EVENT_NAMES: readonly string[] = [...EVENT_TYPES, "done"] as const;
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function normalizeTimestamp(ts: unknown): number {
  if (typeof ts === "number") {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPE_SET.has(value);
}

/** Backend may send numeric IDs; coerce so tool_call / tool_result correlation stays stable. */
function coerceToolId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeEventText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface ReconnectGuardInput {
  readonly isStopped: boolean;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly hasPendingTimer: boolean;
}

export const BACKEND_DISCONNECT_ERROR = "Connection to backend lost before the turn finished.";

export function shouldScheduleReconnect({
  isStopped,
  retryCount,
  maxRetries,
  hasPendingTimer,
}: ReconnectGuardInput): boolean {
  if (isStopped) return false;
  if (retryCount >= maxRetries) return false;
  if (hasPendingTimer) return false;
  return true;
}

interface ExhaustedRetryInput {
  readonly isStopped: boolean;
  readonly retryCount: number;
  readonly maxRetries: number;
}

export function shouldEmitTerminalDisconnectEvent({
  isStopped,
  retryCount,
  maxRetries,
}: ExhaustedRetryInput): boolean {
  if (isStopped) return false;
  return retryCount >= maxRetries;
}

export function createTerminalDisconnectEvent(timestamp = Date.now()): AgentEvent {
  return {
    type: "task_error",
    data: { error: BACKEND_DISCONNECT_ERROR },
    timestamp,
    iteration: null,
  };
}

function normalizeEventData<K extends EventType>(eventType: K, raw: unknown): AgentEventDataByType[K] {
  const data = isRecord(raw) ? raw : {};

  if (eventType === "text_delta") {
    return {
      ...data,
      delta: typeof data.delta === "string" ? data.delta : undefined,
      agent_id: typeof data.agent_id === "string" ? data.agent_id : undefined,
    } as AgentEventDataByType[K];
  }

  if (eventType === "llm_response") {
    return {
      ...data,
      text: typeof data.text === "string" ? data.text : undefined,
      content: typeof data.content === "string" ? data.content : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
    } as AgentEventDataByType[K];
  }

  if (eventType === "thinking") {
    return {
      ...data,
      thinking: typeof data.thinking === "string" ? data.thinking : undefined,
      text: typeof data.text === "string" ? data.text : undefined,
      content: typeof data.content === "string" ? data.content : undefined,
      duration_ms: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
    } as AgentEventDataByType[K];
  }

  if (eventType === "turn_start") {
    return {
      ...data,
      message: typeof data.message === "string" ? data.message : undefined,
      orchestrator_mode:
        data.orchestrator_mode === "planner" || data.orchestrator_mode === "agent"
          ? data.orchestrator_mode
          : undefined,
      execution_shape:
        data.execution_shape === "single_agent"
        || data.execution_shape === "prompt_chain"
        || data.execution_shape === "parallel"
        || data.execution_shape === "orchestrator_workers"
          ? data.execution_shape
          : undefined,
      execution_rationale:
        typeof data.execution_rationale === "string"
          ? data.execution_rationale
          : undefined,
    } as AgentEventDataByType[K];
  }

  if (eventType === "tool_call") {
    const toolId = coerceToolId(data.tool_id) ?? coerceToolId(data.id);
    return {
      ...data,
      tool_id: toolId,
      id: coerceToolId(data.id),
      name: typeof data.name === "string" ? data.name : undefined,
      tool_name: typeof data.tool_name === "string" ? data.tool_name : undefined,
      input: isRecord(data.input) ? data.input : undefined,
      tool_input: isRecord(data.tool_input) ? data.tool_input : undefined,
      arguments: isRecord(data.arguments) ? data.arguments : undefined,
      agent_id: typeof data.agent_id === "string" ? data.agent_id : undefined,
    } as AgentEventDataByType[K];
  }

  if (eventType === "tool_result") {
    const toolId = coerceToolId(data.tool_id) ?? coerceToolId(data.id);
    return {
      ...data,
      tool_id: toolId,
      id: coerceToolId(data.id),
      output: normalizeEventText(data.output),
      result: normalizeEventText(data.result),
      success: typeof data.success === "boolean" ? data.success : undefined,
      content_type: typeof data.content_type === "string" ? data.content_type : undefined,
      artifact_ids: Array.isArray(data.artifact_ids)
        ? data.artifact_ids.filter((id): id is string => typeof id === "string")
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
    } as AgentEventDataByType[K];
  }

  if (eventType === "sandbox_stdout" || eventType === "sandbox_stderr") {
    return {
      ...data,
      text: normalizeEventText(data.text),
    } as AgentEventDataByType[K];
  }

  if (eventType === "artifact_created") {
    return {
      ...data,
      artifact_id: typeof data.artifact_id === "string" ? data.artifact_id : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      content_type: typeof data.content_type === "string" ? data.content_type : undefined,
      size: typeof data.size === "number" ? data.size : undefined,
      file_path: typeof data.file_path === "string" ? data.file_path : undefined,
    } as AgentEventDataByType[K];
  }

  if (eventType === "skill_activated" || eventType === "skill_setup_failed") {
    return {
      ...data,
      name: typeof data.name === "string" ? data.name : undefined,
      source:
        data.source === "auto"
        || data.source === "explicit"
        || data.source === "mid_turn"
        || data.source === "already_active"
          ? data.source
          : undefined,
      phase:
        data.phase === "resources" || data.phase === "dependencies"
          ? data.phase
          : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
      manager: typeof data.manager === "string" ? data.manager : undefined,
      packages: typeof data.packages === "string" ? data.packages : undefined,
    } as AgentEventDataByType[K];
  }

  return data as AgentEventDataByType[K];
}

export function parseSSEEvent(rawJson: string, fallbackEventType: EventType): AgentEvent | null {
  const parsed: unknown = JSON.parse(rawJson);
  if (!isRecord(parsed)) return null;

  const eventType = isEventType(parsed.event_type) ? parsed.event_type : fallbackEventType;
  const dataPayload = isRecord(parsed.data) ? parsed.data : parsed;

  return {
    type: eventType,
    data: normalizeEventData(eventType, dataPayload),
    timestamp: normalizeTimestamp(parsed.timestamp),
    iteration: typeof parsed.iteration === "number" ? parsed.iteration : null,
  } as AgentEvent;
}

// Events that should flush the buffer immediately (user-facing or terminal).
const FLUSH_IMMEDIATELY = new Set<string>([
  "ask_user",
  "task_error",
  "task_complete",
  "turn_complete",
  "turn_cancelled",
  "message_user",
  "skill_activated",
  "skill_setup_failed",
]);

export function shouldFlushEventImmediately(eventType: string): boolean {
  return FLUSH_IMMEDIATELY.has(eventType);
}

export function useSSE(conversationId: string | null, isLive = true) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenersRef = useRef<Array<{ name: string; handler: (e: MessageEvent) => void }>>([]);
  const stoppedRef = useRef(false);

  // --- Event batching: buffer events and flush once per animation frame ---
  const bufferRef = useRef<AgentEvent[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const flushBuffer = useCallback(() => {
    rafIdRef.current = null;
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setEvents((prev) => [...prev, ...batch]);
  }, []);

  const enqueueEvent = useCallback(
    (agentEvent: AgentEvent) => {
      bufferRef.current.push(agentEvent);
      if (shouldFlushEventImmediately(agentEvent.type)) {
        // Cancel pending RAF and flush synchronously for important events.
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
        flushBuffer();
      } else if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushBuffer);
      }
    },
    [flushBuffer],
  );

  const cleanup = useCallback(() => {
    // Flush any remaining buffered events before tearing down.
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    flushBuffer();

    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const es = eventSourceRef.current;
    if (es) {
      for (const { name, handler } of listenersRef.current) {
        es.removeEventListener(name, handler as EventListener);
      }
      listenersRef.current = [];
      es.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, [flushBuffer]);

  const connect = useCallback(
    (id: string) => {
      cleanup();

      const url = `${API_BASE}/conversations/${id}/events`;
      const es = new EventSource(url);
      eventSourceRef.current = es;
      const listeners: Array<{ name: string; handler: (e: MessageEvent) => void }> = [];

      es.onopen = () => {
        setIsConnected(true);
        retryCountRef.current = 0;
      };

      es.onerror = () => {
        setIsConnected(false);

        if (
          !shouldScheduleReconnect({
            isStopped: stoppedRef.current,
            retryCount: retryCountRef.current,
            maxRetries: MAX_RETRIES,
            hasPendingTimer: retryTimerRef.current !== null,
          })
        ) {
          if (
            shouldEmitTerminalDisconnectEvent({
              isStopped: stoppedRef.current,
              retryCount: retryCountRef.current,
              maxRetries: MAX_RETRIES,
            })
          ) {
            enqueueEvent(createTerminalDisconnectEvent());
            stoppedRef.current = true;
            cleanup();
          }
          return;
        }

        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, retryCountRef.current),
          MAX_DELAY_MS,
        );
        retryCountRef.current += 1;

        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          connect(id);
        }, delay);
      };

      for (const eventName of SSE_EVENT_NAMES) {
        if (eventName === "done") {
          // "done" means the server explicitly ended the conversation
          const handler = () => {
            stoppedRef.current = true;
            cleanup();
          };
          es.addEventListener("done", handler as EventListener);
          listeners.push({ name: "done", handler: handler as unknown as (e: MessageEvent) => void });
          continue;
        }

        const handler = (e: MessageEvent) => {
          try {
            const agentEvent = parseSSEEvent(e.data, eventName as EventType);
            if (!agentEvent) return;

            enqueueEvent(agentEvent);
          } catch (err) {
            if (process.env.NODE_ENV === "development") {
              console.warn("[SSE] Failed to parse event:", eventName, e.data, err);
            }
          }
        };
        es.addEventListener(eventName, handler as EventListener);
        listeners.push({ name: eventName, handler });
      }

      listenersRef.current = listeners;
    },
    [cleanup, enqueueEvent],
  );

  useEffect(() => {
    if (!conversationId || !isLive) {
      cleanup();
      setEvents([]);
      return;
    }

    setEvents([]);
    retryCountRef.current = 0;
    stoppedRef.current = false;
    connect(conversationId);

    return cleanup;
  }, [conversationId, isLive, cleanup, connect]);

  /** Remove events from the last assistant turn so a retry doesn't duplicate. */
  const clearLastTurn = useCallback(() => {
    // Drain any in-flight buffered events so they don't leak into the retried turn.
    bufferRef.current = [];
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    setEvents((prev) => {
      // Find the last turn_start — everything from there is the turn we're retrying
      let lastTurnStart = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].type === "turn_start") {
          lastTurnStart = i;
          break;
        }
      }
      if (lastTurnStart === -1) return [];
      return prev.slice(0, lastTurnStart);
    });
  }, []);

  return { events, isConnected, clearLastTurn };
}
