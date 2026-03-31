"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, Copy, Check, Paperclip } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/components/ui/tooltip";
import { TopBar, MarkdownRenderer } from "@/shared/components";
import { AgentProgressCard, AgentComputerPanel } from "@/features/agent-computer";
import { NON_ARTIFACT_TOOLS } from "@/features/agent-computer/lib/tool-constants";
import { ChatInput } from "@/features/conversation";
import { AssistantLoadingSkeleton } from "./AssistantLoadingSkeleton";
import { PlanChecklistPanel } from "./PlanChecklistPanel";
import { StreamingCursor } from "./StreamingCursor";
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
} from "@/shared/types";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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
  thinkingContent: string;
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
  thinkingContent,
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
  const { t } = useTranslation();
  const chatScrollRef = useRef<HTMLDivElement>(null);
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
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, events, toolCalls]);

  const getImageUrlsForMessage = useCallback(
    (msg: ChatMessage): string[] => {
      if (!conversationId || !msg.imageArtifactIds || msg.imageArtifactIds.length === 0) {
        return [];
      }
      return msg.imageArtifactIds.map(
        (aid) => `/api/conversations/${conversationId}/artifacts/${aid}`
      );
    },
    [conversationId],
  );

  const planMessageIndex = useMemo<number | null>(() => {
    const planEvent = events.find((e) => e.type === "plan_created");
    if (!planEvent) return null;

    // Find the last assistant message at or before the plan_created event
    let lastIdx: number | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].timestamp <= planEvent.timestamp) {
        lastIdx = i;
        break;
      }
    }
    // Fallback: first assistant message if none precedes the event
    if (lastIdx === null) {
      const firstAssistant = messages.findIndex((m) => m.role === "assistant");
      lastIdx = firstAssistant >= 0 ? firstAssistant : null;
    }
    return lastIdx;
  }, [events, messages]);

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
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Left pane: Conversation */}
        <div className={cn("flex flex-col", panelOpen ? "w-full border-b border-border lg:w-1/2 lg:border-b-0 lg:border-r" : "w-full")}>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">{t("conversation.waiting")}</p>
              </div>
            )}

            <div className={cn("mx-auto", !panelOpen && "max-w-3xl")} aria-live="polite" aria-relevant="additions">
              {messages.map((msg, i) => {
                const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
                const isStreamingThis = isStreaming && isLastAssistant;

                return (
                  <div
                    key={`msg-${i}`}
                    className={cn(
                      i > 0 && "mt-6",
                    )}
                  >
                    {msg.role === "user" ? (
                      /* ─── User message ─── right-aligned command surface */
                      <motion.div
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.12, ease: "easeOut" }}
                        className="flex justify-end"
                      >
                        <div className="max-w-[90%] min-w-[120px] sm:max-w-[80%]">
                          {/* Frosted card surface */}
                          <div className="rounded-md bg-secondary/40 px-4 py-3 border border-border/50">
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                              {msg.content}
                            </p>
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {msg.attachments.map((att, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-mono text-muted-foreground"
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
                            <div className="mt-1.5 flex items-center justify-end gap-1.5 pr-1">
                              <span className="text-xs font-mono text-muted-foreground-dim tabular-nums">
                                {formatTime(msg.timestamp)}
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
                          "group relative max-w-full min-w-0 sm:max-w-[85%]",
                          isStreamingThis && "pl-4",
                        )}
                      >
                        <div className="relative">
                          {/* Message body */}
                          <div className="text-sm leading-[1.5] text-foreground">
                            <MarkdownRenderer content={msg.content} />
                            <AnimatePresence>
                              {isStreamingThis && <StreamingCursor />}
                            </AnimatePresence>

                            {/* Inline images for this message */}
                            {(() => {
                              const imageUrls = getImageUrlsForMessage(msg);
                              return imageUrls.length > 0 ? (
                                <div className="mt-4 flex flex-wrap gap-3">
                                  {imageUrls.map((url) => (
                                    <img
                                      key={url}
                                      src={url}
                                      alt={t("conversation.imageAlt")}
                                      className="max-h-72 max-w-full rounded-md border border-border object-contain"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  ))}
                                </div>
                              ) : null;
                            })()}

                            {/* Plan checklist embedded in this message */}
                            {i === planMessageIndex && planSteps.length > 0 && (
                              <div className="mt-4">
                                <PlanChecklistPanel planSteps={planSteps} />
                              </div>
                            )}
                          </div>

                          {/* Message action bar */}
                          {isLastAssistant && !isStreaming && (taskState === "idle" || taskState === "complete") && (
                            <div className="mt-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleCopy(msg.content)}
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
              })}

              {planMessageIndex === null && planSteps.length > 0 && (
                <div className="mt-6 max-w-[85%]">
                  <PlanChecklistPanel planSteps={planSteps} />
                </div>
              )}

              <AnimatePresence mode="wait">
                {showLoadingSkeleton && (
                  <div className="mt-6">
                    <AssistantLoadingSkeleton phase={effectivePhase} />
                  </div>
                )}
              </AnimatePresence>
            </div>

          </div>

          {events.length > 0 && (
            <div className={cn("border-t border-border px-4 sm:px-6 py-3", !panelOpen && "mx-auto w-full max-w-3xl")}>
              <AgentProgressCard
                events={events}
                toolCalls={toolCalls}
                agentStatuses={agentStatuses}
                taskState={taskState}
                thinkingContent={thinkingContent}
                onClick={handleProgressCardClick}
                onStepClick={handleStepClick}
                panelOpen={panelOpen}
              />
            </div>
          )}

          <div className={cn("mx-auto w-full", !panelOpen && "max-w-3xl")}>
            <ChatInput
              onSendMessage={onSendMessage}
              disabled={!userCancelled && (isWaitingForAgent || taskState === "executing" || taskState === "planning")}
              onCancel={onCancel}
              isAgentRunning={!userCancelled && (isWaitingForAgent || taskState === "executing" || taskState === "planning")}
            />
          </div>
        </div>

        {/* Right pane: HiAgent's Computer */}
        {panelOpen && (
          <motion.div
            className="flex w-full flex-col md:w-1/2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
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
