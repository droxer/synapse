"use client";

import { memo, useRef, useEffect, useState, useCallback, useMemo } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { RotateCcw, Copy, Check, Paperclip, MessageSquare } from "lucide-react";
import { useStickyBottom } from "@/shared/hooks";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/components/ui/tooltip";
import { TopBar, MarkdownRenderer } from "@/shared/components";
import { EmptyState } from "@/shared/components/EmptyState";
import { AgentProgressCard, AgentComputerPanel } from "@/features/agent-computer";
import { NON_ARTIFACT_TOOLS } from "@/features/agent-computer/lib/tool-constants";
import { ChatInput } from "@/features/conversation";
import { AssistantLoadingSkeleton } from "./AssistantLoadingSkeleton";
import { ThinkingBlock } from "./ThinkingBlock";
import { PlanChecklistPanel } from "./PlanChecklistPanel";
import { ThreadTasksPanel } from "./ThreadTasksPanel";
import { areMessageRowsEqual, type MessageRowMemoProps } from "./message-row-memo";
import {
  getIsCurrentTurnAutoDetected,
  getLatestTurnMode,
  getPlanMessageIndex,
} from "./conversation-mode";
import { resolveThreadTasks } from "../lib/background-tasks";
import {
  buildAssistantCopyText,
} from "../lib/assistant-copy-text";
import { selectThinkingDisplay } from "../lib/thinking-display";
import { cn } from "@/shared/lib/utils";
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
  explicitPlannerPending?: boolean;
  onSendMessage: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  onNavigateHome?: () => void;
  isWaitingForAgent?: boolean;
  userCancelled?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  isLoadingHistory?: boolean;
  hideTopBar?: boolean;
}

// ── Inline image with React-driven error fallback ───────────────────
function InlineImage({ url, alt, fallbackText }: { url: string; alt: string; fallbackText: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className="text-sm text-muted-foreground">{fallbackText}</span>;
  }

  return (
    <img
      src={url}
      alt={alt}
      width={288}
      height={288}
      loading="lazy"
      className="max-h-72 max-w-full rounded-md object-contain"
      onError={() => setFailed(true)}
    />
  );
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
  const thinkingDisplay = selectThinkingDisplay(locale, msg.thinkingEntries, msg.thinkingContent);
  const visibleThinkingEntries = thinkingDisplay.entries;
  const visibleThinkingContent = thinkingDisplay.thinkingContent;
  const showOrphanThinkingContent = Boolean(visibleThinkingContent);
  const hasThinking =
    visibleThinkingEntries.length > 0 || showOrphanThinkingContent;
  const trimmedContent = msg.content.trim();
  const showMarkdown = trimmedContent.length > 0 || isStreamingThis;
  const showEmptyAssistantPlaceholder =
    !showMarkdown &&
    imageUrls.length === 0 &&
    !hasPlanHere &&
    !hasThinking;

  const thinkingEntryCount = visibleThinkingEntries.length;
  const copyAssistantText = buildAssistantCopyText(msg, {
    hasEmbeddedPlan: hasPlanHere,
    planSteps: embeddedPlanSteps,
    imageUrls,
    t,
  });

  return (
    <div data-role={msg.role} className={cn(index > 0 && "mt-6")}>
      {msg.role === "user" ? (
        /* ─── User message ─── right-aligned, refined bubble */
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, x: shouldReduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="flex justify-end"
        >
          <div className={cn("max-w-[94%] min-w-[120px]", messageWidthClass)}>
            <div className="surface-message-user px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {msg.content}
              </p>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {msg.attachments.map((att) => (
                    <span
                      key={att.name}
                      className="inline-flex items-center gap-1 rounded-md bg-background/50 px-2 py-0.5 text-micro font-mono text-muted-foreground"
                    >
                      <Paperclip className="h-3 w-3" />
                      {att.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        /* ─── Assistant message ─── left-aligned, clean with subtle accent */
        <motion.div
          initial={isStreamingThis ? false : { opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "group relative max-w-full min-w-0",
            messageWidthClass,
          )}
        >
          <div className="relative">
            {/* Reasoning blocks */}
            {hasThinking ? (
              <div className="mb-2 space-y-1.5">
                {visibleThinkingEntries.map((entry, entryIdx) => (
                  <ThinkingBlock
                    key={`${msg.messageId ?? msg.timestamp}-thinking-${entry.timestamp ?? entryIdx}`}
                    content={entry.content}
                    isThinking={isThinkingThis && entryIdx === thinkingEntryCount - 1}
                    isTurnStreaming={isStreamingThis || isThinkingThis}
                    durationMs={entry.durationMs}
                  />
                ))}
                {showOrphanThinkingContent ? (
                  <ThinkingBlock
                    key={`${msg.messageId ?? msg.timestamp}-thinking-content`}
                    content={visibleThinkingContent!}
                    isThinking={false}
                    isTurnStreaming={isStreamingThis || isThinkingThis}
                    durationMs={0}
                    summaryLabel={t("thinking.reasoning")}
                  />
                ) : null}
              </div>
            ) : null}
            {/* Message body */}
            <div className="conversation-response-body text-sm leading-[1.5] text-foreground">
              {showMarkdown ? (
                <MarkdownRenderer
                  content={msg.content}
                  isStreaming={isStreamingThis}
                />
              ) : null}
              {showEmptyAssistantPlaceholder ? (
                <p className="text-muted-foreground">{t("conversation.emptyAssistantBody")}</p>
              ) : null}

              {imageUrls.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  {imageUrls.map((url) => (
                    <InlineImage
                      key={url}
                      url={url}
                      alt={t("conversation.imageAlt")}
                      fallbackText={t("conversation.imageUnavailable")}
                    />
                  ))}
                </div>
              ) : null}

              {hasPlanHere && (
                <div className="mt-3">
                  <PlanChecklistPanel planSteps={embeddedPlanSteps} />
                </div>
              )}
            </div>

            {/* Message action bar — inline, no timestamp */}
            {isLastAssistant && !isStreamingThis && (taskState === "idle" || taskState === "complete") && (
              <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleCopy(copyAssistantText.trim() || msg.content)}
                      className="rounded-lg text-muted-foreground-dim hover:text-foreground hover:bg-muted/80"
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
                        className="rounded-lg text-muted-foreground-dim hover:text-foreground hover:bg-muted/80"
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
  explicitPlannerPending = false,
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
  const shouldReduceMotion = useReducedMotion();
  const [panelOpen, setPanelOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const [highlightedStepId, setHighlightedStepId] = useState<string | null>(null);

  useEffect(() => {
    autoOpenedRef.current = false;
  }, [conversationId]);

  useStickyBottom(chatScrollRef, { enabled: true });

  const planMessageIndex = useMemo<number | null>(() => {
    return getPlanMessageIndex(events, messages);
  }, [events, messages]);

  const latestTurnMode = useMemo(() => getLatestTurnMode(events), [events]);
  const effectiveTurnMode = latestTurnMode ?? (explicitPlannerPending ? "planner" : null);
  const effectiveTaskState: TaskState =
    explicitPlannerPending && taskState === "idle" ? "planning" : taskState;
  const effectivePlanSteps = useMemo<readonly PlanStep[]>(
    () =>
      planSteps.length > 0
        ? planSteps
        : explicitPlannerPending
          ? [
              {
                name: t("chat.plannerModeActive"),
                description: t("plan.placeholderDescription"),
                executionType: "planner_owned",
                status: "running",
              } satisfies PlanStep,
            ]
          : [],
    [planSteps, explicitPlannerPending, t],
  );
  const isCurrentTurnAutoDetected = useMemo(() => getIsCurrentTurnAutoDetected(events), [events]);
  const threadTasks = useMemo(() => resolveThreadTasks(toolCalls, events), [toolCalls, events]);

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
  // hasn't responded yet in the current turn. Scan backward from the end: if
  // the most recent non-user message is an assistant, the current turn already
  // has a response and the skeleton is not needed.
  const currentTurnHasAssistantResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return true;
      if (messages[i]?.role === "user") return false;
    }
    return false;
  }, [messages]);
  const showLoadingSkeleton =
    !userCancelled &&
    (isWaitingForAgent
      ? !currentTurnHasAssistantResponse
      : (assistantPhase.phase !== "idle" && !isStreaming)) &&
    messages.length > 0;
  const showPlannerChecklist = planMessageIndex === null && effectivePlanSteps.length > 0;
  const showEmptyState = messages.length === 0 && !showPlannerChecklist;

  const effectivePhase: AssistantPhase = isWaitingForAgent && assistantPhase.phase === "idle"
    ? { phase: "thinking" }
    : assistantPhase;

  const lastAssistantIndex = useMemo(
    () => messages.findLastIndex((m) => m.role === "assistant"),
    [messages],
  );

  const contentWidthClass = useMemo(() => panelOpen ? "max-w-[46rem]" : "max-w-[56rem]", [panelOpen]);
  const messageWidthClass = useMemo(() => panelOpen ? "sm:max-w-[90%]" : "sm:max-w-[85%]", [panelOpen]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="flex h-full flex-col overflow-hidden"
        role="region"
        aria-label="Conversation"
        aria-busy={effectiveTaskState === "executing" || effectiveTaskState === "planning"}
      >
        {!hideTopBar && (
          <TopBar
            taskState={effectiveTaskState}
            isConnected={isConnected}
            onNavigateHome={onNavigateHome}
            conversationTitle={conversationTitle}
            conversationId={conversationId}
            orchestratorMode={effectiveTurnMode}
            isPlannerAutoDetected={isCurrentTurnAutoDetected}
          />
        )}
        <div className="flex flex-1 overflow-hidden">
          <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
              {/* Left pane: Conversation */}
              <div className={cn("relative flex min-h-0 flex-col", panelOpen ? "w-full lg:w-[58%]" : "w-full")}>
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
                  {showEmptyState && (
                    <div className="flex h-full items-center justify-center">
                      <EmptyState
                        icon={MessageSquare}
                        title={t("conversation.waiting")}
                        description={t("conversation.emptyAssistantBody")}
                        dashed
                        className="w-full max-w-md"
                      />
                    </div>
                  )}

                  <div className={cn("mx-auto w-full", contentWidthClass)}>
                    {messages.map((msg, i) => {
                      const isLastAssistant = msg.role === "assistant" && i === lastAssistantIndex;
                      const isStreamingThis = isStreaming && isLastAssistant;
                      const isThinkingThis =
                        msg.role === "assistant" &&
                        isLastAssistant &&
                        assistantPhase.phase === "thinking";
                      const embeddedPlanSteps =
                        i === planMessageIndex && effectivePlanSteps.length > 0 ? effectivePlanSteps : [];
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
                          taskState={effectiveTaskState}
                          locale={locale}
                          onRetry={onRetry}
                          t={t}
                        />
                      );
                    })}

                    {showPlannerChecklist && (
                      <div className={cn("mt-4", messageWidthClass)}>
                        <PlanChecklistPanel planSteps={effectivePlanSteps} />
                      </div>
                    )}

                    {/* Standalone thinking + loading skeleton — fade out together */}
                    <AnimatePresence>
                      {showLoadingSkeleton && (
                        <motion.div
                          key="pre-response-chrome"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.12 }}
                        >
                          {currentThinkingEntries.length > 0 && (
                            <div className={cn("mt-3 max-w-full space-y-1.5", messageWidthClass)}>
                              {currentThinkingEntries.map((entry) => (
                                <ThinkingBlock
                                  key={`current-thinking-${entry.timestamp}`}
                                  content={entry.content}
                                  isThinking={effectivePhase.phase === "thinking"}
                                  isTurnStreaming={isStreaming}
                                  durationMs={entry.durationMs}
                                />
                              ))}
                            </div>
                          )}
                          <div className="mt-3" role="status" aria-live="polite" aria-atomic="true">
                            <AssistantLoadingSkeleton phase={effectivePhase} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="shrink-0 bg-background">
                  {(events.length > 0 || isWaitingForAgent || effectiveTaskState === "planning" || effectiveTaskState === "executing") && (
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
                        planSteps={effectivePlanSteps}
                        taskState={effectiveTaskState}
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
                      disabled={!userCancelled && (isWaitingForAgent || effectiveTaskState === "executing" || effectiveTaskState === "planning")}
                      onCancel={onCancel}
                      isAgentRunning={!userCancelled && (isWaitingForAgent || effectiveTaskState === "executing" || effectiveTaskState === "planning")}
                    />
                  </div>
                </div>
              </div>

              {/* Right pane: Synapse's Computer */}
              <AnimatePresence initial={false}>
                {panelOpen && (
                  <motion.div
                    key="agent-computer-panel"
                    className="relative z-10 flex w-full min-h-0 flex-col overflow-hidden border-l border-border bg-background md:w-[var(--agent-panel-width)]"
                    initial={{ opacity: shouldReduceMotion ? 1 : 0, x: shouldReduceMotion ? 0 : 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: shouldReduceMotion ? 0 : 12 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {isConnected && threadTasks.length > 0 && (
                      <ThreadTasksPanel
                        tasks={threadTasks}
                        locale={locale}
                        t={t}
                      />
                    )}
                    <div className="min-h-0 flex-1">
                      <AgentComputerPanel
                        conversationId={conversationId}
                        toolCalls={toolCalls}
                        agentStatuses={agentStatuses}
                        artifacts={artifacts}
                        taskState={effectiveTaskState}
                        highlightedStepId={highlightedStepId}
                        onClose={() => setPanelOpen(false)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
