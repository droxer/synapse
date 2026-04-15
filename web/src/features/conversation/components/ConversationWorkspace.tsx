"use client";

import { memo, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RotateCcw, Copy, Check, Paperclip } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/components/ui/tooltip";
import { TopBar, MarkdownRenderer } from "@/shared/components";
import { usePacedStreamingText } from "@/shared/hooks";
import { AgentProgressCard, AgentComputerPanel } from "@/features/agent-computer";
import { NON_ARTIFACT_TOOLS } from "@/features/agent-computer/lib/tool-constants";
import { ChatInput } from "@/features/conversation";
import { AssistantLoadingSkeleton } from "./AssistantLoadingSkeleton";
import { ThinkingBlock } from "./ThinkingBlock";
import { PlanChecklistPanel } from "./PlanChecklistPanel";
import { areMessageRowsEqual, type MessageRowMemoProps } from "./message-row-memo";
import { shouldAutoScrollToBottom } from "./conversation-scroll";
import {
  getIsCurrentTurnAutoDetected,
  getLatestTurnMode,
  getPlanMessageIndex,
} from "./conversation-mode";
import {
  buildAssistantCopyText,
  isThinkingContentRedundantWithEntries,
} from "../lib/assistant-copy-text";
import { cn } from "@/shared/lib/utils";
import { formatClockTime } from "@/shared/lib/date-time";
import { useTranslation } from "@/i18n";
import type {
  AgentEvent,
  ArtifactInfo,
  AssistantPhase,
  TaskState,
  ChatMessage,
  ToolCallInfo,
  AgentStatus,
  PlanStep,
  ThinkingEntry,
} from "@/shared/types";

interface ConversationWorkspaceProps {
  conversationId: string | null;
  conversationTitle?: string;
  events: readonly AgentEvent[];
  messages: readonly ChatMessage[];
  toolCalls: readonly ToolCallInfo[];
  agentStatuses: readonly AgentStatus[];
  planSteps: readonly PlanStep[];
  artifacts: readonly ArtifactInfo[];
  taskState: TaskState;
  currentThinkingEntries: readonly ThinkingEntry[];
  isStreaming: boolean;
  assistantPhase: AssistantPhase;
  isConnected: boolean;
  onSendMessage: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  onNavigateHome?: () => void;
  isWaitingForAgent?: boolean;
  userCancelled?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  isLoadingHistory?: boolean;
  hideTopBar?: boolean;
}

// ── Memoized message row ─────────────────────────────────────────────
// Prevents non-streaming messages from re-rendering when only the last
// (streaming) message content changes.

interface MessageRowProps extends MessageRowMemoProps {
  readonly onRetry?: () => void;
  readonly t: (key: string) => string;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLastAssistant,
  isStreamingThis,
  isThinkingThis,
  messageWidthClass,
  embeddedPlanSteps,
  index,
  conversationId,
  taskState,
  locale,
  onRetry,
  t,
}: MessageRowProps) {
  const shouldReduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const displayContent = usePacedStreamingText(msg.content, isStreamingThis);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // ignore
    });
  }, []);
  const getImageUrlsForMessage = useCallback(
    (m: ChatMessage): string[] => {
      if (!conversationId || !m.imageArtifactIds || m.imageArtifactIds.length === 0) {
        return [];
      }
      return m.imageArtifactIds.map(
        (aid) => `/api/conversations/${conversationId}/artifacts/${aid}`
      );
    },
    [conversationId],
  );

  const imageUrls = getImageUrlsForMessage(msg);
  const hasPlanHere = embeddedPlanSteps.length > 0;
  const showOrphanThinkingContent =
    Boolean(msg.thinkingContent?.trim())
    && !isThinkingContentRedundantWithEntries(msg.thinkingContent, msg.thinkingEntries);
  const hasThinking =
    Boolean(msg.thinkingEntries && msg.thinkingEntries.length > 0) || showOrphanThinkingContent;
  const trimmedContent = displayContent.trim();
  const showMarkdown = trimmedContent.length > 0 || isStreamingThis;
  const showEmptyAssistantPlaceholder =
    !showMarkdown &&
    imageUrls.length === 0 &&
    !hasPlanHere &&
    !hasThinking;

  const thinkingEntryCount = msg.thinkingEntries?.length ?? 0;
  const copyAssistantText = buildAssistantCopyText(msg, {
    hasEmbeddedPlan: hasPlanHere,
    planSteps: embeddedPlanSteps,
    imageUrls,
    t,
  });

  return (
    <div data-role={msg.role} className={cn(index > 0 && "mt-4")}>
      {msg.role === "user" ? (
        /* ─── User message ─── right-aligned command surface */
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.12, ease: "easeOut" }}
          className="flex justify-end"
        >
          <div className={cn("max-w-[94%] min-w-[120px]", messageWidthClass)}>
            {/* User bubble */}
            <div className="rounded-xl border border-border bg-secondary px-4 py-3 shadow-card">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {msg.content}
              </p>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.attachments.map((att, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-micro font-mono text-muted-foreground"
                    >
                      <Paperclip className="h-3 w-3" />
                      {att.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Timestamp below, right-aligned */}
            {msg.timestamp && (
              <div className="mt-1 flex items-center justify-end gap-1.5 pr-1">
                <span className="text-micro font-mono text-muted-foreground-dim tabular-nums">
                  {formatClockTime(msg.timestamp, locale)}
                </span>
              </div>
            )}
          </div>
        </motion.div>
      ) : (
        /* ─── Assistant message ─── left-aligned, bounded width */
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.12, ease: "easeOut" }}
          className={cn(
            "conversation-assistant-message group relative max-w-full min-w-0",
            messageWidthClass,
          )}
        >
          <div className="relative">
            {/* Reasoning: event-sourced entries first, then inline-only thinkingContent (not duplicated). */}
            {hasThinking ? (
              <div className="mb-3 space-y-2">
                {msg.thinkingEntries?.map((entry, idx) => (
                  <ThinkingBlock
                    key={`${msg.messageId ?? msg.timestamp}-thinking-${idx}`}
                    content={entry.content}
                    isThinking={isThinkingThis && idx === thinkingEntryCount - 1}
                    isTurnStreaming={isStreamingThis || isThinkingThis}
                    durationMs={entry.durationMs}
                  />
                ))}
                {showOrphanThinkingContent ? (
                  <ThinkingBlock
                    key={`${msg.messageId ?? msg.timestamp}-thinking-content`}
                    content={msg.thinkingContent!}
                    isThinking={false}
                    isTurnStreaming={isStreamingThis || isThinkingThis}
                    durationMs={0}
                    summaryLabel={t("thinking.reasoning")}
                  />
                ) : null}
              </div>
            ) : null}
            {/* Message body: prose, then images, then embedded plan (matches read order). */}
            <div className="conversation-response-body text-sm leading-[1.5] text-foreground">
              {showMarkdown ? (
                <MarkdownRenderer
                  content={displayContent}
                  isStreaming={isStreamingThis}
                />
              ) : null}
              {showEmptyAssistantPlaceholder ? (
                <p className="text-muted-foreground">{t("conversation.emptyAssistantBody")}</p>
              ) : null}

              {/* Inline images for this message */}
              {imageUrls.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  {imageUrls.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt={t("conversation.imageAlt")}
                      width={288}
                      height={288}
                      loading="lazy"
                      className="max-h-72 max-w-full rounded-md object-contain"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        img.classList.add("hidden");
                        const fallback = document.createElement("span");
                        fallback.className = "text-sm text-muted-foreground";
                        fallback.textContent = t("conversation.imageUnavailable");
                        img.parentElement?.appendChild(fallback);
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {/* Plan checklist embedded in this message */}
              {hasPlanHere && (
                <div className="mt-4">
                  <PlanChecklistPanel planSteps={embeddedPlanSteps} />
                </div>
              )}
            </div>

            {msg.timestamp && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-micro font-mono text-muted-foreground-dim/70 tabular-nums select-none">
                  {formatClockTime(msg.timestamp, locale)}
                </span>
              </div>
            )}

            {/* Message action bar */}
            {isLastAssistant && !isStreamingThis && (taskState === "idle" || taskState === "complete") && (
              <div className="mt-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleCopy(copyAssistantText.trim() || msg.content)}
                      className="text-muted-foreground-dim hover:text-foreground hover:bg-secondary active:translate-y-[0.5px]"
                    >
                      {copied
                        ? <Check className="h-3.5 w-3.5 text-accent-emerald" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    {copied ? t("conversation.copied") : t("conversation.copy")}
                  </TooltipContent>
                </Tooltip>

                {onRetry && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={onRetry}
                        className="text-muted-foreground-dim hover:text-foreground hover:bg-secondary active:translate-y-[0.5px]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>
                      {t("conversation.retry")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}, areMessageRowsEqual);

export function ConversationWorkspace({
  conversationId,
  conversationTitle,
  events,
  messages,
  toolCalls,
  agentStatuses,
  planSteps,
  artifacts,
  taskState,
  currentThinkingEntries,
  isStreaming,
  assistantPhase,
  isConnected,
  onSendMessage,
  onNavigateHome,
  isWaitingForAgent = false,
  userCancelled = false,
  onCancel,
  onRetry,
  isLoadingHistory = false,
  hideTopBar = false,
}: ConversationWorkspaceProps) {
  const { t, locale } = useTranslation();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const activityCountRef = useRef(0);
  const shouldReduceMotion = useReducedMotion();
  const [panelOpen, setPanelOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const [highlightedStepId, setHighlightedStepId] = useState<string | null>(null);

  useEffect(() => {
    activityCountRef.current = 0;
  }, [conversationId]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;

    const activityCount = messages.length + events.length + toolCalls.length;
    const prevCount = activityCountRef.current;
    activityCountRef.current = activityCount;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (
      !shouldAutoScrollToBottom({
        previousActivityCount: prevCount,
        nextActivityCount: activityCount,
        distanceFromBottom,
      })
    ) {
      return;
    }

    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, events.length, toolCalls.length]);

  const planMessageIndex = useMemo<number | null>(() => {
    return getPlanMessageIndex(events, messages);
  }, [events, messages]);

  const latestTurnMode = useMemo(() => getLatestTurnMode(events), [events]);
  const isCurrentTurnAutoDetected = useMemo(() => getIsCurrentTurnAutoDetected(events), [events]);

  const hasArtifacts = useMemo(
    () => toolCalls.some((tc) => tc.output !== undefined && !NON_ARTIFACT_TOOLS.has(tc.name)),
    [toolCalls],
  );
  useEffect(() => {
    if (hasArtifacts && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setPanelOpen(true);
    }
  }, [hasArtifacts]);

  const handleProgressCardClick = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const handleStepClick = useCallback((stepId: string) => {
    setPanelOpen(true);
    // Use a fresh value each time to re-trigger the effect even if same step is clicked twice
    setHighlightedStepId(null);
    requestAnimationFrame(() => setHighlightedStepId(stepId));
  }, []);

  // If there's no conversation data and no agent activity, navigate back to
  // the home screen. This handles stale conversationId persisted in localStorage
  // after a page reload, or conversations that failed to load.
  // Wait until history loading completes before deciding.
  useEffect(() => {
    if (
      messages.length === 0 &&
      events.length === 0 &&
      !isWaitingForAgent &&
      !isLoadingHistory &&
      taskState === "idle" &&
      onNavigateHome
    ) {
      onNavigateHome();
    }
  }, [messages.length, events.length, isWaitingForAgent, isLoadingHistory, taskState, onNavigateHome]);

  // When isWaitingForAgent is true, only show the skeleton if the assistant
  // hasn't responded yet (last message is still from the user). This handles
  // fast responses where turn_complete resets both taskState and assistantPhase
  // to idle before the clearing effect fires, leaving isWaitingForAgent stuck.
  const lastMessage = messages[messages.length - 1];
  const showLoadingSkeleton =
    !userCancelled &&
    (isWaitingForAgent
      ? lastMessage?.role !== "assistant"
      : (assistantPhase.phase !== "idle" && !isStreaming)) &&
    messages.length > 0;

  const effectivePhase: AssistantPhase = isWaitingForAgent && assistantPhase.phase === "idle"
    ? { phase: "thinking" }
    : assistantPhase;

  const contentWidthClass = panelOpen ? "max-w-[44rem]" : "max-w-[52rem]";
  const messageWidthClass = panelOpen ? "sm:max-w-[88%]" : "sm:max-w-[82%]";

  return (
    <div
      className="flex h-full flex-col"
      role="region"
      aria-label="Conversation"
      aria-busy={taskState === "executing" || taskState === "planning"}
    >
      {!hideTopBar && (
        <TopBar
          taskState={taskState}
          isConnected={isConnected}
          onNavigateHome={onNavigateHome}
          conversationTitle={conversationTitle}
          conversationId={conversationId}
          orchestratorMode={latestTurnMode}
          isPlannerAutoDetected={isCurrentTurnAutoDetected}
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Left pane: Conversation */}
        <div className={cn("flex flex-col", panelOpen ? "w-full lg:w-[56%]" : "w-full")}>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">{t("conversation.waiting")}</p>
              </div>
            )}

            <div className={cn("mx-auto w-full", contentWidthClass)}>
              {messages.map((msg, i) => {
                const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
                const isStreamingThis = isStreaming && isLastAssistant;
                const isThinkingThis =
                  msg.role === "assistant" &&
                  isLastAssistant &&
                  assistantPhase.phase === "thinking";
                const embeddedPlanSteps =
                  i === planMessageIndex && planSteps.length > 0 ? planSteps : [];
                const messageKey = msg.messageId ?? `${msg.role}-${msg.timestamp}-${i}`;

                return (
                  <MessageRow
                    key={messageKey}
                    msg={msg}
                    isLastAssistant={isLastAssistant}
                    isStreamingThis={isStreamingThis}
                    isThinkingThis={isThinkingThis}
                    messageWidthClass={messageWidthClass}
                    embeddedPlanSteps={embeddedPlanSteps}
                    index={i}
                    conversationId={conversationId}
                    taskState={taskState}
                    locale={locale}
                    onRetry={onRetry}
                    t={t}
                  />
                );
              })}

              {planMessageIndex === null && planSteps.length > 0 && (
                <div className={cn("mt-4", messageWidthClass)}>
                  <PlanChecklistPanel planSteps={planSteps} />
                </div>
              )}

              {/* Standalone thinking block when no assistant message yet */}
              {showLoadingSkeleton && currentThinkingEntries.length > 0 && (
                <div className={cn("mt-4 max-w-full space-y-2", messageWidthClass)}>
                  {currentThinkingEntries.map((entry, idx) => (
                    <ThinkingBlock
                      key={`current-thinking-${entry.timestamp}-${idx}`}
                      content={entry.content}
                      isThinking={effectivePhase.phase === "thinking"}
                      isTurnStreaming={isStreaming}
                      durationMs={entry.durationMs}
                    />
                  ))}
                </div>
              )}

              <AnimatePresence mode="wait">
                {showLoadingSkeleton && (
                  <div className="mt-4" role="status" aria-live="polite" aria-atomic="true">
                    <AssistantLoadingSkeleton phase={effectivePhase} />
                  </div>
                )}
              </AnimatePresence>
            </div>

          </div>

          {(events.length > 0 || isWaitingForAgent || taskState === "planning" || taskState === "executing") && (
            <div
              className={cn(
                "px-4 py-3 sm:px-6",
                "mx-auto w-full",
                contentWidthClass,
              )}
            >
              <AgentProgressCard
                events={events}
                toolCalls={toolCalls}
                agentStatuses={agentStatuses}
                taskState={taskState}
                isWaitingForAgent={isWaitingForAgent}
                onClick={handleProgressCardClick}
                onStepClick={handleStepClick}
                panelOpen={panelOpen}
              />
            </div>
          )}

          <div className={cn("mx-auto w-full", contentWidthClass)}>
            <ChatInput
              onSendMessage={onSendMessage}
              disabled={!userCancelled && (isWaitingForAgent || taskState === "executing" || taskState === "planning")}
              onCancel={onCancel}
              isAgentRunning={!userCancelled && (isWaitingForAgent || taskState === "executing" || taskState === "planning")}
            />
          </div>
        </div>

        {/* Right pane: Synapse's Computer */}
        {panelOpen && (
          <motion.div
            className="flex w-full flex-col border-l border-border bg-secondary/25 md:w-[44%]"
            initial={{ opacity: shouldReduceMotion ? 1 : 0, x: shouldReduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.12, ease: "easeOut" }}
          >
            <AgentComputerPanel
              conversationId={conversationId}
              toolCalls={toolCalls}
              agentStatuses={agentStatuses}
              artifacts={artifacts}
              taskState={taskState}
              highlightedStepId={highlightedStepId}
              onClose={() => setPanelOpen(false)}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}
