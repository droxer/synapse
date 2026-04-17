"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  CircleCheck,
  CircleX,
  Check,
  X,
  FolderOpen,
  GitFork,
  Clock,
  MessageSquare,
  Activity,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import {
  EVENT_LEFT_RAIL_CLASSES,
  EVENT_META_BADGE_CLASSES,
  SKILL_TOOL_NAMES,
  getActivityEntryKind,
  getIconRingClass,
  getToolCallTone,
  getToolCallVisualClasses,
} from "../lib/format-tools";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import { HIDDEN_ACTIVITY_TOOLS, normalizeToolNameI18n } from "../lib/tool-constants";
import { getSkillIcon, getToolIcon } from "../lib/tool-visual-icons";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { SkillActivityEntry } from "./SkillActivityEntry";
import { AgentStatusRow } from "./AgentStatusRow";
import { ArtifactFilesPanel } from "./ArtifactFilesPanel";
import { EmptyState } from "@/shared/components/EmptyState";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { computeAgentTaskProgressPercent } from "@/features/agent-computer/lib/agent-task-progress";
import {
  getTaskStateProgressIndicatorClass,
  isTaskStateLive,
} from "@/features/agent-computer/lib/task-state-display";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { ToolCallInfo, AgentStatus, TaskState, ArtifactInfo } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

function getToolVerb(name: string, t: TFn): string {
  const key = `tools.verb.${name}`;
  const translated = t(key);
  // If key returns itself, fall back to generic
  if (translated === key) return t("computer.usingToolGeneric", { name: normalizeToolNameI18n(name, t) });
  return translated;
}

const COMPUTER_USE_TOOLS = new Set(["computer_action", "computer_screenshot"]);
const AGENT_META_TOOLS = new Set(["agent_spawn", "agent_wait", "agent_send"]);
const TOOL_ICON_FRAME_CLASS = "flex h-5 w-5 shrink-0 items-center justify-center rounded-md";
const TOOL_ICON_GLYPH_CLASS = "h-3.5 w-3.5";

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
          <span className="status-pill status-neutral">
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
          className="ml-1 rounded text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
  return (
    <span className="status-pill status-info">
      {t("computer.running")}
    </span>
  );
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
  const skillId = SKILL_TOOL_NAMES.has(tc.name) ? String(tc.input.name ?? "").trim() : "";
  const kind = getActivityEntryKind(tc.name);
  const tcStatus = tc.success === undefined ? "running" : tc.success ? "complete" : "error";
  const ringClass = getIconRingClass(tcStatus, kind);
  const ToolGlyph = skillId ? getSkillIcon(skillId) : getToolIcon(tc.name);
  if (tc.success !== undefined) {
    return tc.success === false
      ? (
        <span className={cn("relative mt-0.5", TOOL_ICON_FRAME_CLASS, "bg-muted", ringClass)} aria-label={t("a11y.toolFailed")} role="img">
          <ToolGlyph className={cn(TOOL_ICON_GLYPH_CLASS, "text-destructive")} strokeWidth={2.25} />
          <CircleX
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-destructive"
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      )
      : (
        <span className={cn("relative mt-0.5", TOOL_ICON_FRAME_CLASS, "bg-muted", ringClass)} aria-label={t("a11y.toolSuccess")} role="img">
          <ToolGlyph className={cn(TOOL_ICON_GLYPH_CLASS, "text-foreground")} strokeWidth={2.25} />
          <Check
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-accent-emerald"
            strokeWidth={3}
            aria-hidden
          />
        </span>
      );
  }
  return (
    <span className={cn("relative mt-0.5", TOOL_ICON_FRAME_CLASS, "bg-secondary", ringClass)} aria-label={t("a11y.toolRunning")} role="img">
      <ToolGlyph className={cn(TOOL_ICON_GLYPH_CLASS, "text-focus")} strokeWidth={2.25} />
      <span className="absolute inset-0 rounded-md bg-secondary animate-pulsing-dot-fade" />
    </span>
  );
}

type PanelTab = "activity" | "files";
const PANEL_TABS: readonly PanelTab[] = ["activity", "files"];

interface AgentComputerPanelProps {
  conversationId: string | null;
  toolCalls: readonly ToolCallInfo[];
  agentStatuses: readonly AgentStatus[];
  artifacts: readonly ArtifactInfo[];
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
  const activityDigestPrevRef = useRef("");
  const timelineLenPrevRef = useRef(0);
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
    activityDigestPrevRef.current = "";
    timelineLenPrevRef.current = 0;
  }, [conversationId]);

  const activityDigest = useMemo(() => {
    const lastTc = visibleToolCalls[visibleToolCalls.length - 1];
    const toolsPart = visibleToolCalls
      .map(
        (tc) =>
          `${tc.id}:${tc.success === undefined ? "run" : String(tc.success)}:${tc.output !== undefined ? "1" : "0"}`,
      )
      .join("|");
    const agentsPart = agentStatuses
      .map((a) => `${a.agentId}:${a.timestamp}:${String(a.status ?? "")}`)
      .join(";");
    return `${toolsPart}#${agentsPart}#${taskState}#${lastTc?.id ?? ""}`;
  }, [visibleToolCalls, agentStatuses, taskState]);

  const STICK_BOTTOM_PX = 120;

  useEffect(() => {
    const el = contentRef.current;
    if (!el || activeTab !== "activity") return;

    const tlLen = timelineItems.length;
    if (tlLen === 0) {
      visibleToolCallsPrevLenRef.current = visibleToolCalls.length;
      activityDigestPrevRef.current = activityDigest;
      timelineLenPrevRef.current = 0;
      return;
    }

    const isLive = taskState === "executing" || taskState === "planning";
    const digestChanged = activityDigestPrevRef.current !== activityDigest;

    const prevLen = visibleToolCallsPrevLenRef.current;
    const len = visibleToolCalls.length;
    const grew = len > prevLen;
    const firstToolsPopulate = prevLen === 0 && len > 0;

    const prevTl = timelineLenPrevRef.current;
    const timelineFirstPopulate = prevTl === 0 && tlLen > 0;

    activityDigestPrevRef.current = activityDigest;
    visibleToolCallsPrevLenRef.current = len;
    timelineLenPrevRef.current = tlLen;

    if (!digestChanged && !firstToolsPopulate && !grew && !timelineFirstPopulate) {
      return;
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < STICK_BOTTOM_PX;

    const shouldStick =
      (isLive && digestChanged) ||
      timelineFirstPopulate ||
      firstToolsPopulate ||
      (nearBottom && (grew || digestChanged));

    if (shouldStick) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const scrollEl = contentRef.current;
          if (!scrollEl) return;
          scrollEl.scrollTo({
            top: scrollEl.scrollHeight,
            behavior: "smooth",
          });
        });
      });
    }
  }, [activityDigest, activeTab, taskState, visibleToolCalls.length, timelineItems.length]);
  const latestToolCall = visibleToolCalls[visibleToolCalls.length - 1];
  const isRunning = isTaskStateLive(taskState);
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
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-card">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="label-mono flex-1 truncate text-muted-foreground">
            {t("computer.title")}
          </span>
          {/* Inline running status — animated entrance/exit */}
          <AnimatePresence>
            {isRunning && latestToolCall && (
              <motion.span
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex min-w-0 items-center gap-1.5 truncate"
              >
                <PulsingDot size="sm" />
                <span className="truncate text-micro text-muted-foreground">
                  {getRunningToolStatusText(latestToolCall, t)}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("computer.closePanel")}
              onClick={onClose}
              className="shrink-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Tab bar — underline-style, flush with border */}
        <div
          ref={tabListRef}
          className="relative flex gap-0.5 px-3"
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
              "relative flex items-center gap-1.5 px-2.5 pb-2 pt-1 text-caption font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              activeTab === "activity"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            <Activity className="h-4 w-4" />
            {t("computer.activity")}
            {activeTab === "activity" && (
              <span className="absolute inset-x-0 -bottom-px h-[2px] bg-focus" />
            )}
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
              "relative flex items-center gap-1.5 px-2.5 pb-2 pt-1 text-caption font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              activeTab === "files"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            <FolderOpen className="h-4 w-4" />
            {t("computer.artifacts")}
            {artifacts.length > 0 && (
              <span
                className={cn(
                  "ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-sm px-1 text-micro font-semibold tabular-nums transition-colors",
                  activeTab === "files"
                    ? "border border-border bg-secondary text-secondary-foreground"
                    : "chip-muted",
                )}
              >
                {artifacts.length}
              </span>
            )}
            {activeTab === "files" && (
              <span className="absolute inset-x-0 -bottom-px h-[2px] bg-focus" />
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

      {/* ── Activity content area — terminal-style logs ── */}
      {activeTab === "activity" && (
        <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" className="flex min-h-0 flex-1 flex-col bg-background">
          {isRunning && latestToolCall && (
            <div role="status" aria-live="polite" className="sr-only">
              {getRunningToolStatusText(latestToolCall, t)}
            </div>
          )}
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto bg-background px-4 py-3 sm:px-5"
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
                ) : (() => {
                  const tone = getToolCallTone(item.toolCall);
                  const visual = getToolCallVisualClasses(tone);
                  const statusText = item.toolCall.name === "browser_use"
                    ? getBrowserStatusText(item.toolCall, t)
                    : COMPUTER_USE_TOOLS.has(item.toolCall.name)
                      ? getComputerUseStatusText(item.toolCall, t)
                      : normalizeToolNameI18n(item.toolCall.name, t);

                  return (
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
                      className={cn(
                        "rounded-lg px-3 py-2 transition-colors duration-150",
                        visual.row,
                        visual.rowHover,
                      )}
                    >
                      {item.toolCall.thinkingText && (
                        <ThinkingPreview text={item.toolCall.thinkingText} />
                      )}

                      <div className="flex items-start gap-2.5 text-sm">
                        <StatusIcon tc={item.toolCall} />
                        <span className={cn("leading-6", visual.text)}>{statusText}</span>
                        <RunningBadge toolCall={item.toolCall} t={t} />
                        {item.toolCall.success === true && (
                          <span className={cn(EVENT_META_BADGE_CLASSES, "ml-auto", visual.doneBadge)}>
                            {t("computer.statusDone")}
                          </span>
                        )}
                      </div>

                      {AGENT_META_TOOLS.has(item.toolCall.name) && (
                        <AgentMetaDisplay tc={item.toolCall} t={t} agentNameMap={agentNameMap} />
                      )}

                      {Object.keys(item.toolCall.input).length > 0 && item.toolCall.name !== "browser_use" && !COMPUTER_USE_TOOLS.has(item.toolCall.name) && !AGENT_META_TOOLS.has(item.toolCall.name) && (
                        <div className={cn("mt-1 mb-1", EVENT_LEFT_RAIL_CLASSES)}>
                          <ToolArgsDisplay input={item.toolCall.input} />
                        </div>
                      )}

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
                  );
                })()
              )}
            </div>
          </div>

          {/* ── Consolidated status bar ── */}
          <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-3 py-2.5">
            <Progress
              value={progressValue}
              className="h-1.5 flex-1 rounded-full bg-muted"
              indicatorClassName={getTaskStateProgressIndicatorClass(taskState)}
            />

            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
              {isRunning ? (
                <PulsingDot size="sm" />
              ) : taskState === "complete" ? (
                <CircleCheck className="h-3 w-3 text-accent-emerald" />
              ) : taskState === "error" ? (
                <CircleX className="h-3 w-3 text-destructive" />
              ) : null}
              <span
                className={cn(
                  "label-mono",
                  isComplete && "text-muted-foreground",
                  taskState === "error" && "text-destructive",
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
              className={cn(
                "status-pill tabular-nums",
                taskState === "error"
                  ? "status-error"
                  : isRunning
                    ? "status-info"
                    : "status-neutral",
              )}
            >
              {completedCount}/{visibleToolCalls.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
