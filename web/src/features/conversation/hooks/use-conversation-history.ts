"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/shared/stores";
import { fetchMessages, fetchEvents, fetchArtifacts } from "../api/history-api";
import { EVENT_TYPES } from "@/shared/types";
import type { ChatMessage, AgentEvent, EventType, ArtifactInfo } from "@/shared/types";
import { toHistoryChatMessage } from "../lib/message-identity";
import type {
  ConversationArtifactsResponse,
  ConversationEventsResponse,
  ConversationMessagesResponse,
} from "../api/history-api";

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

export function isConversationNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("404");
}

interface ResolvedConversationHistory {
  readonly messages: ChatMessage[];
  readonly events: AgentEvent[];
  readonly artifacts: ArtifactInfo[];
  readonly missingConversation: boolean;
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
  message: { id?: string; role: "user" | "assistant" | "tool"; content: Record<string, unknown> | string; created_at: string },
): ChatMessage {
  return toHistoryChatMessage({
    id: message.id ?? "history-message",
    role: message.role,
    content: message.content,
    iteration: null,
    created_at: message.created_at,
  });
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

export function resolveConversationHistoryResults(
  messagesResult: PromiseSettledResult<ConversationMessagesResponse>,
  eventsResult: PromiseSettledResult<ConversationEventsResponse>,
  artifactsResult: PromiseSettledResult<ConversationArtifactsResponse>,
): ResolvedConversationHistory {
  const messages =
    messagesResult.status === "fulfilled"
      ? messagesResult.value.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(toHistoryChatMessage)
      : [];

  const events =
    eventsResult.status === "fulfilled"
      ? eventsResult.value.events.flatMap(normalizeHistoryEvent)
      : [];

  const artifacts =
    artifactsResult.status === "fulfilled"
      ? artifactsResult.value.artifacts.map(normalizeHistoryArtifact)
      : [];

  const missingConversation =
    (messagesResult.status === "rejected" && isConversationNotFoundError(messagesResult.reason))
    || (eventsResult.status === "rejected" && isConversationNotFoundError(eventsResult.reason));

  return {
    messages,
    events,
    artifacts,
    missingConversation,
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
      const [messagesResult, eventsResult, artifactsResult] = await Promise.allSettled([
        fetchMessages(targetConversationId),
        fetchEvents(targetConversationId),
        fetchArtifacts(targetConversationId),
      ]);

      if (requestSeq !== requestSeqRef.current) {
        return false;
      }

      const resolved = resolveConversationHistoryResults(
        messagesResult,
        eventsResult,
        artifactsResult,
      );

      if (resolved.missingConversation) {
        setHistoryMessages([]);
        setHistoryEvents([]);
        setHistoryArtifacts([]);
        setLoadedConversationId(null);
        clearPendingConversationRoute();
        resetConversation();
        router.replace("/");
        return false;
      }

      if (messagesResult.status === "rejected") {
        console.error("Failed to load conversation messages:", messagesResult.reason);
      }
      if (eventsResult.status === "rejected") {
        console.error("Failed to load conversation events:", eventsResult.reason);
      }
      if (artifactsResult.status === "rejected") {
        console.error("Failed to load conversation artifacts:", artifactsResult.reason);
      }

      setHistoryMessages(resolved.messages);
      setHistoryEvents(resolved.events);
      setHistoryArtifacts(resolved.artifacts);
      setLoadedConversationId(targetConversationId);
      return true;
    } catch (err) {
      if (requestSeq !== requestSeqRef.current) {
        return false;
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
