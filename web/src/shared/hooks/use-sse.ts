"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentEvent, EventType } from "@/shared/types";
import { MAX_RETRIES, BASE_DELAY_MS, MAX_DELAY_MS } from "@/shared/constants";

const SSE_EVENT_NAMES: readonly string[] = [
  "task_start",
  "task_complete",
  "task_error",
  "turn_start",
  "turn_complete",
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
  "agent_complete",
  "thinking",
  "done",
] as const;

function normalizeTimestamp(ts: unknown): number {
  if (typeof ts === "number") {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return Date.now();
}

export function useSSE(conversationId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenersRef = useRef<Array<{ name: string; handler: (e: MessageEvent) => void }>>([]);
  const stoppedRef = useRef(false);

  const cleanup = useCallback(() => {
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
  }, []);

  const connect = useCallback(
    (id: string) => {
      cleanup();

      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const url = `${baseUrl}/conversations/${id}/events`;
      const es = new EventSource(url);
      eventSourceRef.current = es;
      const listeners: Array<{ name: string; handler: (e: MessageEvent) => void }> = [];

      es.onopen = () => {
        setIsConnected(true);
        retryCountRef.current = 0;
      };

      es.onerror = () => {
        setIsConnected(false);

        // Don't retry if the conversation already finished
        if (stoppedRef.current) return;
        if (retryCountRef.current >= MAX_RETRIES) return;

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
            const parsed = JSON.parse(e.data);
            const eventType = (parsed.event_type ?? eventName) as EventType;
            const agentEvent: AgentEvent = {
              type: eventType,
              data: parsed.data ?? parsed,
              timestamp: normalizeTimestamp(parsed.timestamp),
              iteration: parsed.iteration ?? null,
            };
            setEvents((prev) => [...prev, agentEvent]);

            // Terminal events — stop retrying on reconnect
            if (eventType === "task_complete" || eventType === "task_error") {
              stoppedRef.current = true;
            }
          } catch {
            // Skip malformed events
          }
        };
        es.addEventListener(eventName, handler as EventListener);
        listeners.push({ name: eventName, handler });
      }

      listenersRef.current = listeners;
    },
    [cleanup],
  );

  useEffect(() => {
    if (!conversationId) {
      cleanup();
      setEvents([]);
      return;
    }

    setEvents([]);
    retryCountRef.current = 0;
    stoppedRef.current = false;
    connect(conversationId);

    return cleanup;
  }, [conversationId, cleanup, connect]);

  return { events, isConnected };
}
