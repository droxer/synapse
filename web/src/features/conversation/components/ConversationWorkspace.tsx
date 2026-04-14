"use client";

import { memo, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, Copy, Check, Paperclip } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/components/ui/tooltip";
import { TopBar, MarkdownRenderer } from "@/shared/components";
import { AgentProgressCard, AgentComputerPanel } from "@/features/agent-computer";
import { NON_ARTIFACT_TOOLS } from "@/features/agent-computer/lib/tool-constants";
import { ChatInput } from "@/features/conversation";
import { AssistantLoadingSkeleton } from "./AssistantLoadingSkeleton";
import { ThinkingBlock } from "./ThinkingBlock";
import { PlanChecklistPanel } from "./PlanChecklistPanel";
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
import type { Locale } from "@/i18n/types";
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
  events: AgentEvent[];
  messages: ChatMessage[];
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  planSteps: PlanStep[];
  artifacts: ArtifactInfo[];
  taskState: TaskState;
  currentThinkingEntries: ThinkingEntry[];
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

interface MessageRowProps {
  readonly msg: ChatMessage;
  readonly isLastAssistant: boolean;
  readonly isStreamingThis: boolean;
  readonly assistantPhase: AssistantPhase;
  readonly isStreaming: boolean;
  readonly messageWidthClass: string;
  readonly planMessageIndex: number | null;
  readonly planSteps: PlanStep[];
  readonly index: number;
  readonly conversationId: string | null;
  readonly taskState: TaskState;
  readonly locale: Locale;
  readonly onCopy: (text: string) => void;
  readonly copied: boolean;
  readonly onRetry?: () => void;
  readonly t: (key: string) => string;
}

const MessageRow = memo(function MessageRow({
  msg,
  isLastAssistant,
  isStreamingThis,
  assistantPhase,
  isStreaming,
  messageWidthClass,
  planMessageIndex,
  planSteps,
  index,
  conversationId,
  taskState,
  locale,
  onCopy,
  copied,
  onRetry,
  t,
}: MessageRowProps) {
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
  const hasPlanHere = index === planMessageIndex && planSteps.length > 0;
  const showOrphanThinkingContent =
    Boolean(msg.thinkingContent?.trim())
    && !isThinkingContentRedundantWithEntries(msg.thinkingContent, msg.thinkingEntries);
  const hasThinking =
    Boolean(msg.thinkingEntries && msg.thinkingEntries.length > 0) || showOrphanThinkingContent;
  const trimmedContent = msg.content.trim();
  const showMarkdown = trimmedContent.length > 0 || isStreamingThis;
  const showEmptyAssistantPlaceholder =
    !showMarkdown &&
    imageUrls.length === 0 &&
    !hasPlanHere &&
    !hasThinking;

  const thinkingEntryCount = msg.thinkingEntries?.length ?? 0;
  const copyAssistantText = buildAssistantCopyText(msg, {
    hasEmbeddedPlan: hasPlanHere,
    planSteps,
    imageUrls,
    t,
  });

  return (
    <div data-role={msg.role} className={cn(index > 0 && "mt-4")}>
      {msg.role === "user" ? (
        /* ─── User message ─── right-aligned command surface */
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
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
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
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
                    isThinking={
                      isLastAssistant
                      && assistantPhase.phase === "thinking"
                      && idx === thinkingEntryCount - 1
                    }
                    isTurnStreaming={isLastAssistant ? isStreaming : false}
                    durationMs={entry.durationMs}
                  />
                ))}
                {showOrphanThinkingContent ? (
                  <ThinkingBlock
                    key={`${msg.messageId ?? msg.timestamp}-thinking-content`}
                    content={msg.thinkingContent!}
                    isThinking={false}
                    isTurnStreaming={isLastAssistant ? isStreaming : false}
                    durationMs={0}
                    summaryLabel={t("thinking.reasoning")}
                  />
                ) : null}
              </div>
            ) : null}
            {/* Message body: prose, then images, then embedded plan (matches read order). */}
            <div className="conversation-response-body text-sm leading-[1.5] text-foreground">
              {showMarkdown ? (
                <MarkdownRenderer content={msg.content} isStreaming={isStreamingThis} />
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
                      className="max-h-72 max-w-full rounded-md object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {/* Plan checklist embedded in this message */}
              {index === planMessageIndex && planSteps.length > 0 && (
                <div className="mt-4">
                  <PlanChecklistPanel planSteps={planSteps} />
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
            {isLastAssistant && !isStreaming && (taskState === "idle" || taskState === "complete") && (
              <div className="mt-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onCopy(copyAssistantText.trim() || msg.content)}
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
});

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
  const [panelOpen, setPanelOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [highlightedStepId, setHighlightedStepId] = useState<string | null>(null);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

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
                const messageKey = msg.messageId ?? `${msg.role}-${msg.timestamp}-${i}`;

                return (
                  <MessageRow
                    key={messageKey}
                    msg={msg}
                    isLastAssistant={isLastAssistant}
                    isStreamingThis={isStreamingThis}
                    assistantPhase={assistantPhase}
                    isStreaming={isStreaming}
                    messageWidthClass={messageWidthClass}
                    planMessageIndex={planMessageIndex}
                    planSteps={planSteps}
                    index={i}
                    conversationId={conversationId}
                    taskState={taskState}
                    locale={locale}
                    onCopy={handleCopy}
                    copied={copied}
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

          {events.length > 0 && (
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
            className="flex w-full flex-col border-l border-border/70 bg-secondary/25 md:w-[44%]"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
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
