"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/shared/stores";
import { fetchMessages, fetchEvents, fetchArtifacts } from "../api/history-api";
import { EVENT_TYPES } from "@/shared/types";
import type { ChatMessage, AgentEvent, EventType, ArtifactInfo } from "@/shared/types";

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

function isConversationNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("404");
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

export function normalizeHistoryMessage(
  message: { role: "user" | "assistant" | "tool"; content: Record<string, unknown> | string; created_at: string },
): ChatMessage {
  let text: string;
  if (typeof message.content === "string") {
    text = message.content;
  } else if (
    message.content &&
    typeof message.content === "object" &&
    "text" in message.content
  ) {
    text = String(message.content.text);
  } else {
    text = JSON.stringify(message.content);
  }
  return {
    role: message.role as "user" | "assistant",
    content: text,
    timestamp: new Date(message.created_at).getTime(),
  };
}

export function normalizeHistoryEvent(
  event: { type: string; data: Record<string, unknown>; timestamp: string; iteration: number | null },
): AgentEvent[] {
  if (!isEventType(event.type)) {
    return [];
  }
  return [{
    type: event.type,
    data: event.data,
    timestamp: new Date(event.timestamp).getTime(),
    iteration: event.iteration,
  } as AgentEvent];
}

export function normalizeHistoryArtifact(
  artifact: {
    id: string;
    name: string;
    content_type: string;
    size: number;
    created_at: string;
    file_path?: string | null;
  },
): ArtifactInfo {
  return {
    id: artifact.id,
    name: artifact.name,
    contentType: artifact.content_type,
    size: artifact.size,
    createdAt: artifact.created_at,
    ...(artifact.file_path ? { filePath: artifact.file_path } : {}),
  };
}

/**
 * Loads persisted messages and events for the selected conversation.
 * History remains available when transitioning between historical and live mode.
 */
export function useConversationHistory(
  conversationId: string | null,
) {
  const router = useRouter();
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyEvents, setHistoryEvents] = useState<AgentEvent[]>([]);
  const [historyArtifacts, setHistoryArtifacts] = useState<ArtifactInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const prevConversationId = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const resetConversation = useAppStore((state) => state.resetConversation);
  const clearPendingConversationRoute = useAppStore(
    (state) => state.clearPendingConversationRoute,
  );

  const loadHistory = useCallback(async (targetConversationId: string) => {
    const requestSeq = ++requestSeqRef.current;
    setIsLoading(true);

    try {
      const [messagesResponse, eventsResponse, artifactsResponse] = await Promise.all([
        fetchMessages(targetConversationId),
        fetchEvents(targetConversationId),
        fetchArtifacts(targetConversationId),
      ]);

      if (requestSeq !== requestSeqRef.current) {
        return false;
      }

      const messages = messagesResponse.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(normalizeHistoryMessage);

      const events = eventsResponse.events.flatMap(normalizeHistoryEvent);
      const artifacts = artifactsResponse.artifacts.map(normalizeHistoryArtifact);

      setHistoryMessages(messages);
      setHistoryEvents(events);
      setHistoryArtifacts(artifacts);
      setLoadedConversationId(targetConversationId);
      return true;
    } catch (err) {
      if (requestSeq !== requestSeqRef.current) {
        return false;
      }
      if (isConversationNotFoundError(err)) {
        setHistoryMessages([]);
        setHistoryEvents([]);
        setHistoryArtifacts([]);
        setLoadedConversationId(null);
        clearPendingConversationRoute();
        resetConversation();
        router.replace("/");
      }
      console.error("Failed to load conversation history:", err);
      return false;
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [clearPendingConversationRoute, resetConversation, router]);

  // Clear history immediately when switching conversations so stale
  // transcript/events do not flash while the next fetch is in flight.
  useEffect(() => {
    if (prevConversationId.current !== conversationId) {
      prevConversationId.current = conversationId;
      setHistoryMessages([]);
      setHistoryEvents([]);
      setHistoryArtifacts([]);
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
    void loadHistory(conversationId).then((ok) => {
      if (cancelled || ok) return;
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId, loadHistory]);

  const refetchHistory = useCallback(async () => {
    if (!conversationId) return false;
    return loadHistory(conversationId);
  }, [conversationId, loadHistory]);

  return {
    historyMessages,
    historyEvents,
    historyArtifacts,
    isLoading: isConversationHistoryLoading(
      conversationId,
      loadedConversationId,
      isLoading,
    ),
    refetchHistory,
  };
}
