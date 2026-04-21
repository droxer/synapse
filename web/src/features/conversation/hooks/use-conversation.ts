"use client";

import { startTransition, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/shared/stores";
import {
  createConversation,
  sendFollowUpMessage,
  cancelTurn,
  retryTurn,
} from "../api/conversation-api";
import {
  createOptimisticMessageId,
  reconcileOptimisticConversationMessages,
  type OptimisticUserMatchState,
} from "../lib/message-identity";
import { getConversationPath } from "../lib/routes";
import type { AgentEvent, AssistantPhase, ChatMessage, TaskState } from "@/shared/types";

export interface PendingSelectedSkill {
  readonly name: string;
  readonly timestamp: number;
}

const TERMINAL_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "task_complete",
  "task_error",
  "turn_complete",
  "turn_cancelled",
]);

export function shouldClearWaitingForTerminalState(
  isWaitingForAgent: boolean,
  taskState: TaskState,
): boolean {
  if (!isWaitingForAgent) return false;
  return taskState === "complete" || taskState === "error";
}

export function hasTerminalEventSince(
  events: readonly AgentEvent[],
  startIndex: number,
): boolean {
  for (let i = Math.max(0, startIndex); i < events.length; i += 1) {
    if (TERMINAL_EVENT_TYPES.has(events[i]!.type)) {
      return true;
    }
  }
  return false;
}

export function normalizeSelectedSkills(
  skills: readonly string[] | undefined,
  timestamp: number,
): PendingSelectedSkill[] {
  if (!skills?.length) return [];
  const seen = new Set<string>();
  const normalized: PendingSelectedSkill[] = [];
  for (const skill of skills) {
    const trimmed = skill.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push({ name: trimmed, timestamp });
  }
  return normalized;
}

export function useConversation(
  transcriptMessages: ChatMessage[],
  taskState: TaskState,
  events: AgentEvent[] = [],
  assistantPhase: AssistantPhase,
  clearLastTurn?: () => void,
) {
  const router = useRouter();
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const [userCancelled, setUserCancelled] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingSelectedSkills, setPendingSelectedSkills] = useState<PendingSelectedSkill[]>([]);
  const [explicitPlannerPending, setExplicitPlannerPending] = useState(false);
  const eventsLengthRef = useRef(events.length);
  eventsLengthRef.current = events.length;
  const eventCountAtSendRef = useRef(events.length);
  const optimisticMessageSequenceRef = useRef(0);
  const optimisticUserMatchStateRef = useRef<Map<string, OptimisticUserMatchState>>(new Map());

  const conversationId = useAppStore((s) => s.conversationId);
  const isLiveConversation = useAppStore((s) => s.isLiveConversation);
  const startConversation = useAppStore((s) => s.startConversation);
  const switchConversation = useAppStore((s) => s.switchConversation);
  const resumeConversation = useAppStore((s) => s.resumeConversation);
  const updateConversationTitle = useAppStore((s) => s.updateConversationTitle);
  const setPendingConversationRoute = useAppStore((s) => s.setPendingConversationRoute);
  const clearPendingConversationRoute = useAppStore((s) => s.clearPendingConversationRoute);

  // Clear waiting state only when NEW events arrive (after send) and
  // the assistant has actually started responding. This prevents the
  // skeleton from being immediately cleared by stale events from prior turns.
  useEffect(() => {
    if (!isWaitingForAgent) return;
    const hasNewEvents = events.length > eventCountAtSendRef.current;
    if (!hasNewEvents) return;

    if (hasTerminalEventSince(events, eventCountAtSendRef.current)) {
      setIsWaitingForAgent(false);
      setPendingSelectedSkills([]);
      setExplicitPlannerPending(false);
      return;
    }

    if (taskState !== "idle" || assistantPhase.phase !== "idle") {
      setIsWaitingForAgent(false);
      setExplicitPlannerPending(false);
    }
  }, [isWaitingForAgent, taskState, events, assistantPhase.phase]);

  // Failsafe: clear waiting when task reaches a terminal state.
  // Handles fast responses where all events batch-arrive and both
  // taskState and assistantPhase are already idle by the time React renders.
  useEffect(() => {
    if (shouldClearWaitingForTerminalState(isWaitingForAgent, taskState)) {
      setIsWaitingForAgent(false);
      setPendingSelectedSkills([]);
      setExplicitPlannerPending(false);
    }
  }, [isWaitingForAgent, taskState]);

  // Clear userCancelled when the backend confirms cancellation via SSE
  useEffect(() => {
    if (userCancelled && (taskState === "idle" || taskState === "complete")) {
      setUserCancelled(false);
    }
  }, [userCancelled, taskState]);

  // Reset local state when switching away from a conversation externally
  // (e.g. sidebar). We track the previous ID to avoid clearing state when
  // conversationId transitions from null → newId (initial creation), since
  // that would wipe out `isWaitingForAgent` set by handleCreateConversation.
  const prevConversationIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    const prev = prevConversationIdRef.current;
    prevConversationIdRef.current = conversationId;
    if (prev !== null && prev !== conversationId) {
      setUserMessages([]);
      optimisticUserMatchStateRef.current = new Map();
      setIsWaitingForAgent(false);
      setUserCancelled(false);
      setCreateError(null);
      setPendingSelectedSkills([]);
      setExplicitPlannerPending(false);
    }
  }, [conversationId]);

  // Update conversation title when the LLM generates one
  const lastTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    const titleEvent = events.find((e) => e.type === "conversation_title");
    if (titleEvent) {
      const title = titleEvent.data.title as string;
      if (title && title !== lastTitleRef.current) {
        lastTitleRef.current = title;
        updateConversationTitle(conversationId, title);
      }
    }
  }, [conversationId, events, updateConversationTitle]);

  const transcriptUserCount = useMemo(
    () => transcriptMessages.filter((message) => message.role === "user").length,
    [transcriptMessages],
  );
  const transcriptMessageCount = transcriptMessages.length;

  const allMessages = useMemo(() => {
    if (userMessages.length === 0) return transcriptMessages;
    return reconcileOptimisticConversationMessages(
      transcriptMessages,
      userMessages,
      optimisticUserMatchStateRef.current,
    );
  }, [userMessages, transcriptMessages]);

  const buildOptimisticUserMessage = useCallback(
    (message: string, timestamp: number, files?: File[]): ChatMessage => {
      const attachments = files?.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      }));
      optimisticMessageSequenceRef.current += 1;
      const messageId = createOptimisticMessageId(
        conversationId ?? "new-conversation",
        optimisticMessageSequenceRef.current,
      );
      optimisticUserMatchStateRef.current.set(messageId, {
        transcriptUserCountAtSend: transcriptUserCount,
        transcriptMessageCountAtSend: transcriptMessageCount,
      });
      return {
        messageId,
        role: "user",
        content: message,
        timestamp,
        source: "optimistic",
        ...(attachments?.length ? { attachments } : {}),
      };
    },
    [conversationId, transcriptMessageCount, transcriptUserCount],
  );

  const handleCreateConversation = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      const now = Date.now();
      eventCountAtSendRef.current = eventsLengthRef.current;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setCreateError(null);
      setPendingSelectedSkills(normalizeSelectedSkills(skills, now));
      setExplicitPlannerPending(usePlanner === true);
      setUserMessages([buildOptimisticUserMessage(message, now, files)]);

      try {
        const data = await createConversation(message, files, skills, usePlanner);
        setPendingConversationRoute(data.conversation_id);
        startConversation(data.conversation_id, message);
        // Update URL without triggering a Next.js navigation to avoid
        // re-mounting the ConversationProvider tree that is already
        // showing the workspace via isOptimisticallyStarting.
        window.history.replaceState(
          window.history.state,
          "",
          getConversationPath(data.conversation_id),
        );
      } catch (err) {
        console.error("Failed to create conversation:", err);
        clearPendingConversationRoute();
        setIsWaitingForAgent(false);
        setPendingSelectedSkills([]);
        setExplicitPlannerPending(false);
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setCreateError(`Failed to start conversation: ${errorMessage}`);
        setUserMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${errorMessage}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [
      buildOptimisticUserMessage,
      clearPendingConversationRoute,
      setPendingConversationRoute,
      startConversation,
    ],
  );

  const handleSendFollowUp = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) return;

      const now = Date.now();
      eventCountAtSendRef.current = eventsLengthRef.current;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setPendingSelectedSkills(normalizeSelectedSkills(skills, now));
      setExplicitPlannerPending(usePlanner === true);
      setUserMessages((prev) => [
        ...prev,
        buildOptimisticUserMessage(message, now, files),
      ]);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
      } catch (err) {
        console.error("Failed to send message:", err);
        setIsWaitingForAgent(false);
        setPendingSelectedSkills([]);
        setExplicitPlannerPending(false);
        setUserMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [buildOptimisticUserMessage, conversationId],
  );

  const handleResumeConversation = useCallback(
    async (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) return;

      const now = Date.now();
      eventCountAtSendRef.current = eventsLengthRef.current;
      setIsWaitingForAgent(true);
      setUserCancelled(false);
      setPendingSelectedSkills(normalizeSelectedSkills(skills, now));
      setExplicitPlannerPending(usePlanner === true);
      setUserMessages((prev) => [
        ...prev,
        buildOptimisticUserMessage(message, now, files),
      ]);

      try {
        await sendFollowUpMessage(conversationId, message, files, skills, usePlanner);
        resumeConversation();
      } catch (err) {
        console.error("Failed to resume conversation:", err);
        setIsWaitingForAgent(false);
        setPendingSelectedSkills([]);
        setExplicitPlannerPending(false);
        setUserMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    [buildOptimisticUserMessage, conversationId, resumeConversation],
  );

  const handleSendMessage = useCallback(
    (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => {
      if (!conversationId) {
        handleCreateConversation(message, files, skills, usePlanner);
      } else if (!isLiveConversation) {
        handleResumeConversation(message, files, skills, usePlanner);
      } else {
        handleSendFollowUp(message, files, skills, usePlanner);
      }
    },
    [conversationId, isLiveConversation, handleCreateConversation, handleResumeConversation, handleSendFollowUp],
  );

  const handleSwitchConversation = useCallback(
    (id: string) => {
      if (id === conversationId) return;
      switchConversation(id);
      setUserMessages([]);
      optimisticUserMatchStateRef.current = new Map();
      setIsWaitingForAgent(false);
      setUserCancelled(false);
      setCreateError(null);
      setPendingSelectedSkills([]);
    },
    [conversationId, switchConversation],
  );

  const handleNewConversation = useCallback(() => {
    clearPendingConversationRoute();
    setUserMessages([]);
    optimisticUserMatchStateRef.current = new Map();
    setIsWaitingForAgent(false);
    setUserCancelled(false);
    setCreateError(null);
    setPendingSelectedSkills([]);
    startTransition(() => {
      router.push("/");
    });
  }, [clearPendingConversationRoute, router]);

  const handleCancel = useCallback(() => {
    if (!conversationId) return;
    setIsWaitingForAgent(false);
    setUserCancelled(true);
    setPendingSelectedSkills([]);
    // Fire and forget — don't block the UI on the backend cancel
    cancelTurn(conversationId).catch((err) => {
      console.error("Failed to cancel turn:", err);
      setUserCancelled(false);
    });
  }, [conversationId]);

  const handleRetry = useCallback(async () => {
    if (!conversationId) return;
    try {
      clearLastTurn?.();
      const result = await retryTurn(conversationId);
      if (result.status === "retrying") {
        eventCountAtSendRef.current = events.length;
        setUserCancelled(false);
        setIsWaitingForAgent(true);
        setPendingSelectedSkills([]);
      }
    } catch (err) {
      console.error("Failed to retry turn:", err);
    }
  }, [conversationId, events.length, clearLastTurn]);

  return {
    conversationId,
    allMessages,
    pendingSelectedSkills,
    explicitPlannerPending,
    isWaitingForAgent,
    userCancelled,
    createError,
    handleSendMessage,
    handleCreateConversation,
    handleSwitchConversation,
    handleNewConversation,
    handleCancel,
    handleRetry,
  };
}
