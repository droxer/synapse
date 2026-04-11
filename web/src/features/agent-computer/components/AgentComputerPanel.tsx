"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Monitor,
  CircleCheck,
  CircleX,
  X,
  FolderOpen,
  GitFork,
  Clock,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import {
  formatToolPreview,
  EVENT_LEFT_RAIL_CLASSES,
  EVENT_META_BADGE_CLASSES,
  EVENT_ROW_BASE_CLASSES,
} from "../lib/format-tools";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import { HIDDEN_ACTIVITY_TOOLS, normalizeToolNameI18n } from "../lib/tool-constants";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { SkillActivityEntry } from "./SkillActivityEntry";
import { AgentStatusRow } from "./AgentStatusRow";
import { ArtifactFilesPanel } from "./ArtifactFilesPanel";
import { EmptyState } from "@/shared/components/EmptyState";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { computeAgentTaskProgressPercent } from "@/features/agent-computer/lib/agent-task-progress";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { ToolCallInfo, AgentStatus, TaskState, ArtifactInfo } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

const SKILL_TOOL_NAMES = new Set(["activate_skill", "load_skill"]);

function getToolVerb(name: string, t: TFn): string {
  const key = `tools.verb.${name}`;
  const translated = t(key);
  // If key returns itself, fall back to generic
  if (translated === key) return t("computer.usingToolGeneric", { name: normalizeToolNameI18n(name, t) });
  return translated;
}

const COMPUTER_USE_TOOLS = new Set(["computer_action", "computer_screenshot"]);
const AGENT_META_TOOLS = new Set(["agent_spawn", "agent_wait", "agent_send"]);

/** Polished display for agent_spawn tool calls. */
function SpawnAgentDisplay({ tc }: { readonly tc: ToolCallInfo }) {
  const agentName = String(tc.input.name ?? "");
  const taskDesc = String(tc.input.task_description ?? "");
  const role = String(tc.input.role ?? "");

  return (
    <div className={cn("mb-2 py-1.5", EVENT_LEFT_RAIL_CLASSES)}>
      <div className="flex items-center gap-2">
        <GitFork className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{agentName}</span>
        {role && (
          <span className="status-pill chip-muted">
            {role}
          </span>
        )}
      </div>
      {taskDesc && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {taskDesc.length > 200 ? taskDesc.slice(0, 197) + "..." : taskDesc}
        </p>
      )}
    </div>
  );
}

/** Polished display for agent_wait tool calls. */
function WaitForAgentsDisplay({ tc, t, agentNameMap }: { readonly tc: ToolCallInfo; readonly t: TFn; readonly agentNameMap: ReadonlyMap<string, string> }) {
  const agentIds = Array.isArray(tc.input.agent_ids) ? tc.input.agent_ids as string[] : [];
  const waitingAll = agentIds.length === 0;

  return (
    <div className={cn("mb-2 py-1.5", EVENT_LEFT_RAIL_CLASSES)}>
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {waitingAll
            ? t("computer.waitingAllAgents")
            : t("computer.waitingAgents", { count: agentIds.length })}
        </span>
      </div>
      {!waitingAll && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {agentIds.map((id) => (
            <span
              key={id}
              className="status-pill chip-muted"
            >
              {agentNameMap.get(String(id)) || String(id).slice(0, 8)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Polished display for agent_send tool calls. */
function AgentSendDisplay({ tc, t, agentNameMap }: { readonly tc: ToolCallInfo; readonly t: TFn; readonly agentNameMap: ReadonlyMap<string, string> }) {
  const targetId = String(tc.input.agent_id ?? "");
  const message = String(tc.input.message ?? "");
  const isBroadcast = targetId === "all";

  return (
    <div className={cn("mb-2 py-1.5", EVENT_LEFT_RAIL_CLASSES)}>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {isBroadcast
            ? t("computer.broadcastMessage")
            : t("computer.sendToAgent", { id: agentNameMap.get(targetId) || targetId.slice(0, 8) })}
        </span>
      </div>
      {message && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {message.length > 200 ? message.slice(0, 197) + "..." : message}
        </p>
      )}
    </div>
  );
}

const THINKING_PREVIEW_LENGTH = 150;

function ThinkingPreview({ text }: { readonly text: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > THINKING_PREVIEW_LENGTH;
  const shown = expanded || !isLong ? text : text.slice(0, THINKING_PREVIEW_LENGTH);

  return (
    <div className={cn("mb-2 py-0.5", EVENT_LEFT_RAIL_CLASSES)}>
      <span className="text-xs italic text-muted-foreground leading-relaxed">
        {shown}
        {isLong && !expanded && "..."}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-1 rounded text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? t("computer.thinkingCollapse") : t("computer.thinkingReadMore")}
        </button>
      )}
    </div>
  );
}

/** Renders the appropriate polished display for an agent meta tool call. */
function AgentMetaDisplay({ tc, t, agentNameMap }: { readonly tc: ToolCallInfo; readonly t: TFn; readonly agentNameMap: ReadonlyMap<string, string> }) {
  if (tc.name === "agent_spawn") return <SpawnAgentDisplay tc={tc} />;
  if (tc.name === "agent_wait") return <WaitForAgentsDisplay tc={tc} t={t} agentNameMap={agentNameMap} />;
  if (tc.name === "agent_send") return <AgentSendDisplay tc={tc} t={t} agentNameMap={agentNameMap} />;
  return null;
}

function getRunningToolStatusText(toolCall: ToolCallInfo, t: TFn): string {
  if (SKILL_TOOL_NAMES.has(toolCall.name)) {
    return t("computer.loadingSkill", { name: normalizeSkillName(String(toolCall.input.name ?? "skill")) });
  }
  if (toolCall.name === "browser_use") {
    return getBrowserStatusText(toolCall, t);
  }
  if (COMPUTER_USE_TOOLS.has(toolCall.name)) {
    return getComputerUseStatusText(toolCall, t);
  }
  if (toolCall.name === "agent_spawn") {
    return t("computer.spawningAgent", { name: String(toolCall.input.name ?? "agent") });
  }
  if (toolCall.name === "agent_wait") {
    return t("computer.waitingForAgents");
  }
  if (toolCall.name === "agent_send") {
    return t("computer.sendingMessage");
  }
  return t("computer.usingTool", { verb: getToolVerb(toolCall.name, t) });
}

function RunningBadge({ toolCall, t }: { readonly toolCall: ToolCallInfo; readonly t: TFn }) {
  if (toolCall.success !== undefined) return null;
  return <span className="text-foreground">{t("computer.running")}</span>;
}

function getComputerUseStatusText(tc: ToolCallInfo, t: TFn): string {
  const action = tc.computerUseMetadata?.action ?? (tc.input.action as string | undefined);
  if (tc.name === "computer_screenshot" || !action) {
    return t("computer.takingScreenshot");
  }
  return t("computer.desktopAction", { action: action.replace(/_/g, " ") });
}

function getBrowserStatusText(tc: ToolCallInfo, t: TFn): string {
  const url = tc.input.url as string | undefined;
  if (url) {
    try {
      const hostname = new URL(url).hostname;
      return t("computer.browsingUrl", { hostname });
    } catch { /* fall through */ }
  }
  const task = tc.input.task as string | undefined;
  if (task) {
    const truncated = task.length > 60 ? task.slice(0, 57) + "..." : task;
    return t("computer.browsingTask", { task: truncated });
  }
  return t("computer.usingTool", { verb: getToolVerb("browser_use", t) });
}

/* ── status icon for terminal-style logs ── */
function StatusIcon({ tc }: { readonly tc: ToolCallInfo }) {
  const { t } = useTranslation();
  if (tc.success !== undefined) {
    return tc.success === false
      ? <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" aria-label={t("a11y.toolFailed")} role="img" />
      : <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" aria-label={t("a11y.toolSuccess")} role="img" />;
  }
  return <PulsingDot size="sm" aria-label={t("a11y.toolRunning")} />;
}

type PanelTab = "activity" | "files";
const PANEL_TABS: readonly PanelTab[] = ["activity", "files"];

interface AgentComputerPanelProps {
  conversationId: string | null;
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  artifacts: ArtifactInfo[];
  taskState: TaskState;
  highlightedStepId?: string | null;
  onClose?: () => void;
}

export function AgentComputerPanel({
  conversationId,
  toolCalls,
  agentStatuses,
  artifacts,
  taskState,
  highlightedStepId,
  onClose,
}: AgentComputerPanelProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const visibleToolCallsPrevLenRef = useRef(0);
  const [activeTab, setActiveTab] = useState<PanelTab>("activity");
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted step and flash it
  useEffect(() => {
    if (!highlightedStepId) return;
    // Switch to activity tab when a step is clicked
    setActiveTab("activity");
    setActiveHighlight(highlightedStepId);

    // Wait a frame for the DOM to update after tab switch
    requestAnimationFrame(() => {
      // Exact match first, then prefix match for agent steps (agent-{id}-{ts} → agent-{id})
      let el = contentRef.current?.querySelector(
        `[data-step-id="${highlightedStepId}"]`,
      );
      if (!el && highlightedStepId.startsWith("agent-")) {
        // agentId may contain dashes, so match by prefix
        const allStepEls = contentRef.current?.querySelectorAll("[data-step-id]") ?? [];
        for (const candidate of allStepEls) {
          const sid = candidate.getAttribute("data-step-id") ?? "";
          if (sid.startsWith("agent-") && highlightedStepId.startsWith(sid)) {
            el = candidate;
            break;
          }
        }
      }
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    // Clear highlight after animation
    const timer = setTimeout(() => setActiveHighlight(null), 2800);
    return () => clearTimeout(timer);
  }, [highlightedStepId]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();

      const currentIndex = PANEL_TABS.indexOf(activeTab);
      const nextIndex =
        e.key === "ArrowRight"
          ? (currentIndex + 1) % PANEL_TABS.length
          : (currentIndex - 1 + PANEL_TABS.length) % PANEL_TABS.length;

      const nextTab = PANEL_TABS[nextIndex];
      setActiveTab(nextTab);

      const nextButton = tabListRef.current?.querySelector<HTMLElement>(
        `#tab-${nextTab}`,
      );
      nextButton?.focus();
    },
    [activeTab],
  );

  const visibleToolCalls = useMemo(
    () => toolCalls.filter((t) => !HIDDEN_ACTIVITY_TOOLS.has(t.name)),
    [toolCalls],
  );

  // Split tool calls: parent (no agentId) vs grouped by agentId
  const { parentToolCalls, agentToolCallsMap } = useMemo(() => {
    const parent: ToolCallInfo[] = [];
    const agentMap = new Map<string, ToolCallInfo[]>();

    for (const tc of visibleToolCalls) {
      if (tc.agentId) {
        const existing = agentMap.get(tc.agentId);
        if (existing) {
          existing.push(tc);
        } else {
          agentMap.set(tc.agentId, [tc]);
        }
      } else {
        parent.push(tc);
      }
    }

    return { parentToolCalls: parent, agentToolCallsMap: agentMap };
  }, [visibleToolCalls]);

  // Unified timeline: interleave parent tool calls and agent status rows by timestamp
  type TimelineItem =
    | { readonly kind: "tool"; readonly toolCall: ToolCallInfo }
    | { readonly kind: "agent"; readonly agent: AgentStatus };

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const tc of parentToolCalls) {
      items.push({ kind: "tool", toolCall: tc });
    }
    for (const agent of agentStatuses) {
      items.push({ kind: "agent", agent });
    }
    items.sort((a, b) => {
      const tsA = a.kind === "tool" ? a.toolCall.timestamp : a.agent.timestamp;
      const tsB = b.kind === "tool" ? b.toolCall.timestamp : b.agent.timestamp;
      return tsA - tsB;
    });
    return items;
  }, [parentToolCalls, agentStatuses]);

  // Map agentId → human-readable name for display in wait/send tool calls
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentStatuses) {
      if (agent.name) {
        map.set(agent.agentId, agent.name);
      }
    }
    return map;
  }, [agentStatuses]);

  useEffect(() => {
    visibleToolCallsPrevLenRef.current = 0;
  }, [conversationId]);

  const STICK_BOTTOM_PX = 120;

  useEffect(() => {
    const el = contentRef.current;
    if (!el || activeTab !== "activity") return;

    const prevLen = visibleToolCallsPrevLenRef.current;
    const len = visibleToolCalls.length;
    const grew = len > prevLen;
    const firstPopulate = prevLen === 0 && len > 0;
    visibleToolCallsPrevLenRef.current = len;

    if (len === 0 || (!grew && !firstPopulate)) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < STICK_BOTTOM_PX;

    if (firstPopulate || nearBottom) {
      requestAnimationFrame(() => {
        const scrollEl = contentRef.current;
        if (!scrollEl) return;
        scrollEl.scrollTo({
          top: scrollEl.scrollHeight,
          behavior: "smooth",
        });
      });
    }
  }, [visibleToolCalls, activeTab]);
  const latestToolCall = visibleToolCalls[visibleToolCalls.length - 1];
  const isRunning = taskState === "executing" || taskState === "planning";
  const isComplete = taskState === "complete";

  const completedCount = useMemo(
    () => visibleToolCalls.filter((t) => t.output !== undefined).length,
    [visibleToolCalls],
  );

  const progressValue = useMemo(
    () =>
      computeAgentTaskProgressPercent(
        taskState,
        completedCount,
        visibleToolCalls.length,
      ),
    [taskState, completedCount, visibleToolCalls.length],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header with tabs ── */}
      <div className="shrink-0 bg-background">
        <div className="flex items-center justify-between px-4 pb-1 pt-2">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {t("computer.title")}
          </span>
          <div className="flex items-center gap-1">
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("computer.closePanel")}
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div
          ref={tabListRef}
          className="flex gap-2 px-4 pb-2 sm:px-4"
          role="tablist"
          aria-label={t("computer.tabsLabel")}
          onKeyDown={handleTabKeyDown}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            aria-controls="panel-activity"
            id="tab-activity"
            tabIndex={activeTab === "activity" ? 0 : -1}
            onClick={() => setActiveTab("activity")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium transition-colors",
              activeTab === "activity"
                ? "border border-border bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
            )}
          >
            <Monitor className="h-3.5 w-3.5" />
            {t("computer.activity")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "files"}
            aria-controls="panel-files"
            id="tab-files"
            tabIndex={activeTab === "files" ? 0 : -1}
            onClick={() => setActiveTab("files")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium transition-colors",
              activeTab === "files"
                ? "border border-border bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("computer.artifacts")}
            {artifacts.length > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-muted/20 px-1 text-micro font-semibold text-muted-foreground">
                {artifacts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Files tab ── */}
      {activeTab === "files" && (
        <div id="panel-files" role="tabpanel" aria-labelledby="tab-files" className="flex-1 overflow-y-auto">
          <ArtifactFilesPanel artifacts={artifacts} conversationId={conversationId} />
        </div>
      )}

      {/* ── Activity tab ── */}
      {activeTab === "activity" && isRunning && latestToolCall && (
        <div className="flex shrink-0 items-center gap-2 px-4 py-1.5" role="status" aria-live="polite">
          <PulsingDot size="sm" />
          <span className="text-sm font-medium text-muted-foreground">
            {getRunningToolStatusText(latestToolCall, t)}
          </span>
          {latestToolCall.output === undefined && !SKILL_TOOL_NAMES.has(latestToolCall.name) && latestToolCall.name !== "browser_use" && !COMPUTER_USE_TOOLS.has(latestToolCall.name) && !AGENT_META_TOOLS.has(latestToolCall.name) && (
            <span className="ml-auto hidden min-w-0 max-w-[45%] truncate font-mono text-caption text-muted-foreground-dim sm:inline sm:text-sm">
              {formatToolPreview(latestToolCall.input)}
            </span>
          )}
        </div>
      )}
      {/* ── Activity content area — terminal-style logs ── */}
      {activeTab === "activity" && (
        <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" className="flex min-h-0 flex-1 flex-col bg-background">
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto px-4 py-3 sm:px-5"
          >
            {/* Empty state */}
            {timelineItems.length === 0 && (
              <EmptyState
                icon={Monitor}
                description={t("computer.waitingActivity")}
                className="h-full"
              />
            )}

            {/* Unified timeline: tool calls and agent status rows interleaved by timestamp */}
            <div className="space-y-2">
              {timelineItems.map((item) =>
                item.kind === "agent" ? (
                  <div key={`agent-${item.agent.agentId}`} data-step-id={`agent-${item.agent.agentId}`}>
                    <AgentStatusRow
                      agent={item.agent}
                      variant="light"
                      toolCalls={agentToolCallsMap.get(item.agent.agentId)}
                      conversationId={conversationId}
                      agentNameMap={agentNameMap}
                    />
                  </div>
                ) : SKILL_TOOL_NAMES.has(item.toolCall.name) ? (
                  <SkillActivityEntry key={item.toolCall.id} toolCall={item.toolCall} />
                ) : (
                  <motion.div
                    key={item.toolCall.id}
                    data-step-id={`tool-${item.toolCall.id}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      backgroundColor: activeHighlight === `tool-${item.toolCall.id}`
                        ? "var(--color-secondary)"
                        : "transparent",
                    }}
                    transition={{ duration: 0.12, ease: "easeOut" }}
                    className={cn(EVENT_ROW_BASE_CLASSES, "transition-colors")}
                  >
                    {/* Thinking preview — shown above the tool call it produced */}
                    {item.toolCall.thinkingText && (
                      <ThinkingPreview text={item.toolCall.thinkingText} />
                    )}

                    {/* Log line */}
                    <div className="flex items-start gap-2.5 text-sm">
                      <StatusIcon tc={item.toolCall} />
                      {item.toolCall.name === "browser_use" ? (
                        <>
                          <span
                            className={cn(
                              item.toolCall.output !== undefined && item.toolCall.success === false
                                  ? "text-accent-rose"
                                  : "text-foreground",
                            )}
                          >
                            {getBrowserStatusText(item.toolCall, t)}
                          </span>
                          <RunningBadge toolCall={item.toolCall} t={t} />
                        </>
                      ) : COMPUTER_USE_TOOLS.has(item.toolCall.name) ? (
                        <>
                          <span
                            className={cn(
                              item.toolCall.output !== undefined && item.toolCall.success === false
                                  ? "text-accent-rose"
                                  : "text-foreground",
                            )}
                          >
                            {getComputerUseStatusText(item.toolCall, t)}
                          </span>
                          <RunningBadge toolCall={item.toolCall} t={t} />
                        </>
                      ) : (
                        <>
                          <span
                            className={cn(
                              item.toolCall.output !== undefined && item.toolCall.success === false
                                  ? "text-accent-rose"
                                  : "text-foreground",
                            )}
                          >
                            {normalizeToolNameI18n(item.toolCall.name, t)}
                          </span>
                          <RunningBadge toolCall={item.toolCall} t={t} />
                        </>
                      )}
                      {item.toolCall.success === true && (
                        <span className={cn(EVENT_META_BADGE_CLASSES, "ml-auto")}>
                          {t("computer.statusDone")}
                        </span>
                      )}
                    </div>

                    {/* Polished agent meta tool display */}
                    {AGENT_META_TOOLS.has(item.toolCall.name) && (
                      <AgentMetaDisplay tc={item.toolCall} t={t} agentNameMap={agentNameMap} />
                    )}

                    {/* Args detail box — skip for browser_use, computer_use, and agent_spawn (have custom displays) */}
                    {Object.keys(item.toolCall.input).length > 0 && item.toolCall.name !== "browser_use" && !COMPUTER_USE_TOOLS.has(item.toolCall.name) && !AGENT_META_TOOLS.has(item.toolCall.name) && (
                      <div className={cn("mt-1 mb-1", EVENT_LEFT_RAIL_CLASSES)}>
                        <ToolArgsDisplay input={item.toolCall.input} />
                      </div>
                    )}

                    {/* Output (collapsible) */}
                    {item.toolCall.output !== undefined && (
                      <div className={cn("mt-1 mb-1", EVENT_LEFT_RAIL_CLASSES)}>
                        <ToolOutputRenderer
                          output={item.toolCall.output}
                          toolName={item.toolCall.name}
                          success={item.toolCall.success}
                          contentType={item.toolCall.contentType}
                          conversationId={conversationId}
                          artifactIds={item.toolCall.artifactIds}
                          browserMetadata={item.toolCall.browserMetadata}
                          computerUseMetadata={item.toolCall.computerUseMetadata}
                          agentNameMap={agentNameMap}
                        />
                      </div>
                    )}
                  </motion.div>
                ),
              )}
            </div>
          </div>

          {/* ── Consolidated status bar ── */}
          <div className="flex shrink-0 items-center gap-2.5 px-4 py-2">
            <Progress
              value={progressValue}
              className="h-1 flex-1"
              indicatorClassName={cn(
                isComplete && "bg-accent-emerald",
                taskState === "error" && "bg-accent-rose",
                isRunning && "bg-foreground",
                taskState === "idle" && "bg-muted-foreground",
              )}
            />

            <div className="ml-1 flex items-center gap-1.5">
              {isRunning ? (
                <PulsingDot size="sm" />
              ) : taskState === "complete" ? (
                <CircleCheck className="h-3.5 w-3.5 text-accent-emerald" />
              ) : taskState === "error" ? (
                <CircleX className="h-3.5 w-3.5 text-accent-rose" />
              ) : null}
              <span
                className={cn(
                  "text-micro font-medium tracking-wide",
                  isComplete && "text-accent-emerald",
                  taskState === "error" && "text-accent-rose",
                  (isRunning || taskState === "idle") && "text-muted-foreground",
                )}
              >
                {taskState === "complete"
                  ? t("computer.statusDone")
                  : isRunning
                    ? t("computer.statusLive")
                    : taskState === "error"
                      ? t("computer.statusError")
                      : t("computer.statusIdle")}
              </span>
            </div>

            <span
                className={cn("status-pill px-1.5 tabular-nums", isComplete ? "bg-accent-emerald/10 text-accent-emerald" : "chip-muted")}
            >
              {completedCount}/{visibleToolCalls.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
