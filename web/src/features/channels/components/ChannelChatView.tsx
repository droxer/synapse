"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSSE, useSessionFilteredArtifacts } from "@/shared/hooks";
import { ConversationWorkspace, usePendingAsk } from "@/features/conversation";
import { useConversationTranscript } from "@/features/conversation/hooks/use-conversation-transcript";
import {
  sendFollowUpMessage,
  cancelTurn,
  retryTurn,
} from "@/features/conversation/api/conversation-api";
import {
  fetchMessages,
  fetchEvents,
  fetchArtifacts,
} from "@/features/conversation/api/history-api";
import { EVENT_TYPES } from "@/shared/types";
import type { ChatMessage, AgentEvent, EventType, ArtifactInfo } from "@/shared/types";
import type { ChannelConversation } from "../api/channel-api";
import { getProviderLabel } from "./ChannelProviderIcon";
import { MessageCircle } from "lucide-react";
import { submitChannelMessage } from "../lib/channel-chat-submit";
import { useTranslation } from "@/i18n";

interface ChannelChatViewProps {
  conversation: ChannelConversation;
  hideTopBar?: boolean;
}

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

export function ChannelChatView({ conversation, hideTopBar }: ChannelChatViewProps) {
  const { t } = useTranslation();
  const { conversation_id: conversationId } = conversation;

  // Always connect SSE for live updates
  const [isLive, setIsLive] = useState(true);
  const { events: sseEvents, isConnected, clearLastTurn } = useSSE(conversationId, isLive);

  // History loading (simplified — no global store dependency)
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyEvents, setHistoryEvents] = useState<AgentEvent[]>([]);
  const [historyArtifacts, setHistoryArtifacts] = useState<ArtifactInfo[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevIdRef.current !== conversationId) {
      prevIdRef.current = conversationId;
      setHistoryMessages([]);
      setHistoryEvents([]);
      setHistoryArtifacts([]);
    }
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);

    Promise.all([
      fetchMessages(conversationId),
      fetchEvents(conversationId),
      fetchArtifacts(conversationId),
    ])
      .then(([msgRes, evtRes, artifactRes]) => {
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

        const artifacts: ArtifactInfo[] = artifactRes.artifacts.map((artifact) => ({
          id: artifact.id,
          name: artifact.name,
          contentType: artifact.content_type,
          size: artifact.size,
          createdAt: artifact.created_at,
          ...(artifact.file_path ? { filePath: artifact.file_path } : {}),
        }));

        setHistoryMessages(messages);
        setHistoryEvents(events);
        setHistoryArtifacts(artifacts);
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryMessages([]);
          setHistoryEvents([]);
          setHistoryArtifacts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => { cancelled = true; };
  }, [conversationId]);

  const {
    effectiveEvents,
    messages,
    artifacts: transcriptArtifacts,
    agentState: {
      toolCalls,
      taskState,
      agentStatuses,
      planSteps,
      currentThinkingEntries,
      isStreaming,
      assistantPhase,
    },
  } = useConversationTranscript(
    historyMessages,
    historyEvents,
    historyArtifacts,
    sseEvents,
    isLive,
  );

  const artifacts = useSessionFilteredArtifacts(transcriptArtifacts);

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

  const { pendingAsk, handlePromptSubmit, respondError } = usePendingAsk(effectiveEvents, conversationId);

  const handleSendMessage = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      eventCountRef.current = effectiveEvents.length;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setPendingMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() }]);
      setIsLive(true);

      try {
        await submitChannelMessage({
          message,
          pendingAsk,
          sendFollowUp: (nextMessage) =>
            sendFollowUpMessage(conversationId, nextMessage, files, skills, usePlanner),
          respondToPrompt: handlePromptSubmit,
        });
      } catch (err) {
        setIsWaitingForAgent(false);
        setPendingMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    },
    [conversationId, effectiveEvents.length, handlePromptSubmit, pendingAsk],
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

  const displayName = conversation.display_name ?? conversation.provider_chat_id;
  const providerLabel = getProviderLabel(conversation.provider);
  const title = `${displayName} · ${providerLabel}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {pendingAsk && (
        <div className="border-b border-border bg-secondary/60 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("inputPrompt.title")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {pendingAsk.question}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("inputPrompt.subtitle")}
              </p>
              {respondError && (
                <p className="mt-2 text-xs text-destructive">
                  {respondError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
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
      </div>
    </div>
  );
}
