"use client";

import { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/shared/stores";
import { fetchMessages, fetchEvents } from "../api/history-api";
import { EVENT_TYPES } from "@/shared/types";
import type { ChatMessage, AgentEvent, EventType } from "@/shared/types";

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

export function isConversationHistoryLoading(
  conversationId: string | null,
  loadedConversationId: string | null,
  isLoading: boolean,
): boolean {
  if (!conversationId) {
    return false;
  }
  return isLoading || loadedConversationId !== conversationId;
}

/**
 * Loads persisted messages and events for the selected conversation.
 * History remains available when transitioning between historical and live mode.
 */
export function useConversationHistory(
  conversationId: string | null,
) {
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyEvents, setHistoryEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const prevConversationId = useRef<string | null>(null);
  const resetConversation = useAppStore((state) => state.resetConversation);

  // Clear history immediately when switching conversations so stale
  // transcript/events do not flash while the next fetch is in flight.
  useEffect(() => {
    if (prevConversationId.current !== conversationId) {
      prevConversationId.current = conversationId;
      setHistoryMessages([]);
      setHistoryEvents([]);
      setLoadedConversationId(null);
    }
  }, [conversationId]);

  // Fetch persisted history for any selected conversation so the transcript
  // can survive refreshes and SSE reconnects.
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      fetchMessages(conversationId),
      fetchEvents(conversationId),
    ])
      .then(([messagesResponse, eventsResponse]) => {
        if (cancelled) return;

        const messages: ChatMessage[] = messagesResponse.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            let text: string;
            if (typeof m.content === "string") {
              text = m.content;
            } else if (
              m.content &&
              typeof m.content === "object" &&
              "text" in m.content
            ) {
              text = String(m.content.text);
            } else {
              text = JSON.stringify(m.content);
            }
            return {
              role: m.role as "user" | "assistant",
              content: text,
              timestamp: new Date(m.created_at).getTime(),
            };
          });

        const events: AgentEvent[] = eventsResponse.events.flatMap((e) => {
          if (!isEventType(e.type)) {
            return [];
          }
          return [{
            type: e.type,
            data: e.data,
            timestamp: new Date(e.timestamp).getTime(),
            iteration: e.iteration,
          } as AgentEvent];
        });

        setHistoryMessages(messages);
        setHistoryEvents(events);
        setLoadedConversationId(conversationId);
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof Error && err.message.includes("404")) {
            setHistoryMessages([]);
            setHistoryEvents([]);
            setLoadedConversationId(null);
            resetConversation();
          }
          console.error("Failed to load conversation history:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, resetConversation]);

  return {
    historyMessages,
    historyEvents,
    isLoading: isConversationHistoryLoading(
      conversationId,
      loadedConversationId,
      isLoading,
    ),
  };
}
