"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSSE, useSessionFilteredArtifacts } from "@/shared/hooks";
import { useAgentState } from "@/features/agent-computer";
import { ConversationWorkspace, usePendingAsk, mergeUniqueEvents } from "@/features/conversation";
import {
  sendFollowUpMessage,
  cancelTurn,
  retryTurn,
} from "@/features/conversation/api/conversation-api";
import { fetchMessages, fetchEvents } from "@/features/conversation/api/history-api";
import { EVENT_TYPES } from "@/shared/types";
import type { ChatMessage, AgentEvent, EventType } from "@/shared/types";
import type { ChannelConversation } from "../api/channel-api";
import { getProviderLabel } from "./ChannelProviderIcon";

interface ChannelChatViewProps {
  conversation: ChannelConversation;
  hideTopBar?: boolean;
}

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

export function ChannelChatView({ conversation, hideTopBar }: ChannelChatViewProps) {
  const { conversation_id: conversationId } = conversation;

  // Always connect SSE for live updates
  const [isLive, setIsLive] = useState(true);
  const { events: sseEvents, isConnected, clearLastTurn } = useSSE(conversationId, isLive);

  // History loading (simplified — no global store dependency)
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyEvents, setHistoryEvents] = useState<AgentEvent[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevIdRef.current !== conversationId) {
      prevIdRef.current = conversationId;
      setHistoryMessages([]);
      setHistoryEvents([]);
    }
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);

    Promise.all([fetchMessages(conversationId), fetchEvents(conversationId)])
      .then(([msgRes, evtRes]) => {
        if (cancelled) return;

        const messages: ChatMessage[] = msgRes.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            let text: string;
            const content = m.content as Record<string, unknown>;
            if (typeof content === "string") {
              text = content;
            } else if (content && "text" in content) {
              text = String(content.text);
            } else {
              text = JSON.stringify(content);
            }
            return { role: m.role as "user" | "assistant", content: text, timestamp: new Date(m.created_at).getTime() };
          });

        const events: AgentEvent[] = evtRes.events.flatMap((e) => {
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
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryMessages([]);
          setHistoryEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => { cancelled = true; };
  }, [conversationId]);

  // Merge history + live events, deduplicating by event key to avoid
  // duplicate processing when SSE queue buffers events also present in DB history.
  const effectiveEvents = useMemo(
    () => mergeUniqueEvents(historyEvents, sseEvents),
    [historyEvents, sseEvents],
  );

  const {
    messages: eventMessages,
    toolCalls,
    taskState,
    agentStatuses,
    planSteps,
    artifacts: rawArtifacts,
    currentThinkingEntries,
    isStreaming,
    assistantPhase,
  } = useAgentState(effectiveEvents);

  const artifacts = useSessionFilteredArtifacts(rawArtifacts);

  // Merge DB messages + event-derived messages (de-duplicate)
  const messages = useMemo<ChatMessage[]>(() => {
    const merged = [...historyMessages];
    for (const msg of eventMessages) {
      const isDuplicate = merged.some(
        (m) =>
          m.role === msg.role &&
          m.content === msg.content &&
          Math.abs(m.timestamp - msg.timestamp) < 30_000,
      );
      if (!isDuplicate) {
        merged.push(msg);
      } else {
        const idx = merged.findIndex(
          (m) =>
            m.role === msg.role &&
            m.content === msg.content &&
            Math.abs(m.timestamp - msg.timestamp) < 30_000,
        );
        if (idx !== -1) {
          const existing = merged[idx];
          merged[idx] = {
            ...existing,
            imageArtifactIds:
              msg.imageArtifactIds && msg.imageArtifactIds.length > 0
                ? [...(existing.imageArtifactIds ?? []), ...msg.imageArtifactIds]
                : existing.imageArtifactIds,
            thinkingEntries:
              msg.thinkingEntries && msg.thinkingEntries.length > 0
                ? [...(existing.thinkingEntries ?? []), ...msg.thinkingEntries]
                : existing.thinkingEntries,
            thinkingContent: existing.thinkingContent || msg.thinkingContent,
          };
        }
      }
    }
    return merged.sort((a, b) => a.timestamp - b.timestamp);
  }, [historyMessages, eventMessages]);

  // Local pending user messages (optimistic)
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const [userCancelled, setUserCancelled] = useState(false);
  const eventCountRef = useRef(effectiveEvents.length);

  // Clear waiting state when new events arrive
  useEffect(() => {
    if (!isWaitingForAgent) return;
    if (effectiveEvents.length > eventCountRef.current && (taskState !== "idle" || assistantPhase.phase !== "idle")) {
      setIsWaitingForAgent(false);
    }
  }, [isWaitingForAgent, effectiveEvents.length, taskState, assistantPhase.phase]);

  useEffect(() => {
    if (!isWaitingForAgent) return;
    if (taskState === "complete" || taskState === "error") setIsWaitingForAgent(false);
  }, [isWaitingForAgent, taskState]);

  useEffect(() => {
    if (userCancelled && (taskState === "idle" || taskState === "complete")) setUserCancelled(false);
  }, [userCancelled, taskState]);

  const allMessages = useMemo<ChatMessage[]>(() => {
    const filtered = pendingMessages.filter(
      (p) => !messages.some((m) => m.role === p.role && m.content === p.content && Math.abs(m.timestamp - p.timestamp) < 30_000),
    );
    return [...filtered, ...messages].sort((a, b) => a.timestamp - b.timestamp);
  }, [pendingMessages, messages]);

  const handleSendMessage = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      eventCountRef.current = effectiveEvents.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setPendingMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() }]);
      setIsLive(true);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
      } catch (err) {
        setIsWaitingForAgent(false);
        setPendingMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    },
    [conversationId, effectiveEvents.length],
  );

  const handleCancel = useCallback(() => {
    setIsWaitingForAgent(false);
    setUserCancelled(true);
    cancelTurn(conversationId).catch(() => {});
  }, [conversationId]);

  const handleRetry = useCallback(async () => {
    try {
      clearLastTurn();
      const result = await retryTurn(conversationId);
      if (result.status === "retrying") {
        eventCountRef.current = effectiveEvents.length;
        setIsWaitingForAgent(true);
      }
    } catch {
      // ignore
    }
  }, [conversationId, effectiveEvents.length, clearLastTurn]);

  const { pendingAsk: _pendingAsk, handlePromptSubmit: _handlePromptSubmit } = usePendingAsk(effectiveEvents, conversationId);

  const displayName = conversation.display_name ?? conversation.provider_chat_id;
  const providerLabel = getProviderLabel(conversation.provider);
  const title = `${displayName} · ${providerLabel}`;

  return (
    <ConversationWorkspace
      conversationId={conversationId}
      conversationTitle={title}
      hideTopBar={hideTopBar}
      events={effectiveEvents}
      messages={allMessages}
      toolCalls={toolCalls}
      agentStatuses={agentStatuses}
      planSteps={planSteps}
      artifacts={artifacts}
      taskState={taskState}
      currentThinkingEntries={currentThinkingEntries}
      isStreaming={isStreaming}
      assistantPhase={assistantPhase}
      isConnected={isConnected}
      onSendMessage={handleSendMessage}
      isWaitingForAgent={isWaitingForAgent}
      userCancelled={userCancelled}
      onCancel={handleCancel}
      onRetry={handleRetry}
      isLoadingHistory={isLoadingHistory}
    />
  );
}
