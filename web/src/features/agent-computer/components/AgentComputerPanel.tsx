"use client";

import { useEffect, useRef, useMemo, useState, useCallback, useId } from "react";
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
  RefreshCw,
  ExternalLink,
  PanelTop,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import {
  EVENT_LEFT_RAIL_CLASSES,
  EVENT_META_BADGE_CLASSES,
  SKILL_TOOL_NAMES,
  getToolCallTone,
  getToolCallVisualClasses,
} from "../lib/format-tools";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import {
  HIDDEN_ACTIVITY_TOOLS,
  normalizeAgentName,
  normalizeToolNameI18n,
} from "../lib/tool-constants";
import { getSkillIcon, getToolIcon } from "../lib/tool-visual-icons";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { SkillActivityEntry } from "./SkillActivityEntry";
import { AgentStatusRow } from "./AgentStatusRow";
import { ArtifactFilesPanel } from "./ArtifactFilesPanel";
import { EmptyState } from "@/shared/components/EmptyState";
import { cn } from "@/shared/lib/utils";
import { TOOLING_ACTIVITY_ROW_CLASSES } from "@/shared/lib/tooling-ui-styles";
import { useTranslation } from "@/i18n";
import { computeAgentTaskProgressPercent } from "@/features/agent-computer/lib/agent-task-progress";
import {
  getTaskStateProgressIndicatorClass,
  isTaskStateLive,
} from "@/features/agent-computer/lib/task-state-display";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { useStickyBottom } from "@/shared/hooks";
import { useSessionFilteredArtifacts } from "@/shared/hooks/use-session-filtered-artifacts";
import type { ToolCallInfo, AgentStatus, TaskState, ArtifactInfo, PreviewSession } from "@/shared/types";
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
        <span className="text-sm font-medium text-foreground">{normalizeAgentName(agentName)}</span>
        {role && (
          <span className="status-pill status-neutral">
            {role}
          </span>
        )}
      </div>
      {taskDesc && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
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
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
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
  const contentId = useId();
  const isLong = text.length > THINKING_PREVIEW_LENGTH;
  const shown = expanded || !isLong ? text : text.slice(0, THINKING_PREVIEW_LENGTH);

  return (
    <div className={cn("mb-2 py-0.5", EVENT_LEFT_RAIL_CLASSES)}>
      <span id={contentId} className="text-sm italic leading-relaxed text-muted-foreground">
        {shown}
        {isLong && !expanded && "..."}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-controls={contentId}
          aria-expanded={expanded}
          className="ml-1 rounded text-sm text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          {expanded ? t("computer.thinkingCollapse") : t("computer.thinkingReadMore")}
        </button>
      )}
    </div>
  );
}

function ActivityTimelineToolCallRow({
  toolCall,
  activeHighlight,
  conversationId,
  agentNameMap,
}: {
  readonly toolCall: ToolCallInfo;
  readonly activeHighlight: string | null;
  readonly conversationId: string | null;
  readonly agentNameMap: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const tone = getToolCallTone(toolCall);
  const visual = getToolCallVisualClasses(tone);
  const statusText = toolCall.name === "browser_use"
    ? getBrowserStatusText(toolCall, t)
    : COMPUTER_USE_TOOLS.has(toolCall.name)
      ? getComputerUseStatusText(toolCall, t)
      : normalizeToolNameI18n(toolCall.name, t);

  return (
    <motion.div
      data-step-id={`tool-${toolCall.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        backgroundColor: activeHighlight === `tool-${toolCall.id}`
          ? "var(--color-secondary)"
          : "rgba(0, 0, 0, 0)",
      }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className={cn(
        TOOLING_ACTIVITY_ROW_CLASSES,
        visual.row,
        visual.rowHover,
      )}
    >
      {toolCall.thinkingText && (
        <ThinkingPreview text={toolCall.thinkingText} />
      )}

      <div className="flex items-start gap-2.5 text-sm">
        <StatusIcon tc={toolCall} />
        <span className={cn("min-w-0 flex-1 leading-6", visual.text)}>
          {statusText}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <RunningBadge toolCall={toolCall} t={t} />
          {toolCall.success === true && (
            <span className={cn(EVENT_META_BADGE_CLASSES, visual.doneBadge)}>
              {t("computer.statusDone")}
            </span>
          )}
        </div>
      </div>

      {AGENT_META_TOOLS.has(toolCall.name) && (
        <AgentMetaDisplay tc={toolCall} t={t} agentNameMap={agentNameMap} />
      )}

      {Object.keys(toolCall.input).length > 0 && toolCall.name !== "browser_use" && !COMPUTER_USE_TOOLS.has(toolCall.name) && !AGENT_META_TOOLS.has(toolCall.name) && (
        <div className={cn("mt-1 mb-1", EVENT_LEFT_RAIL_CLASSES)}>
          <ToolArgsDisplay input={toolCall.input} />
        </div>
      )}

      {toolCall.output !== undefined && (
        <div className={cn("mt-1 mb-1", EVENT_LEFT_RAIL_CLASSES)}>
          <ToolOutputRenderer
            output={toolCall.output}
            toolName={toolCall.name}
            success={toolCall.success}
            contentType={toolCall.contentType}
            conversationId={conversationId}
            artifactIds={toolCall.artifactIds}
            browserMetadata={toolCall.browserMetadata}
            computerUseMetadata={toolCall.computerUseMetadata}
            agentNameMap={agentNameMap}
          />
        </div>
      )}
    </motion.div>
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

function highlightedStepTargetsAgent(
  highlightedStepId: string | null | undefined,
  agentId: string | null | undefined,
): boolean {
  return Boolean(
    highlightedStepId
      && agentId
      && highlightedStepId.startsWith(`agent-${agentId}-`),
  );
}

/* ── status icon for terminal-style logs ── */
function StatusIcon({ tc }: { readonly tc: ToolCallInfo }) {
  const { t } = useTranslation();
  const skillId = SKILL_TOOL_NAMES.has(tc.name) ? String(tc.input.name ?? "").trim() : "";
  const ToolGlyph = skillId ? getSkillIcon(skillId) : getToolIcon(tc.name);
  if (tc.success !== undefined) {
    return tc.success === false
      ? (
        <span className={cn("relative mt-0.5", TOOL_ICON_FRAME_CLASS, "bg-muted")} aria-label={t("a11y.toolFailed")} role="img">
          <ToolGlyph className={cn(TOOL_ICON_GLYPH_CLASS, "text-destructive")} strokeWidth={2.25} />
          <CircleX
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-destructive"
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      )
      : (
        <span className={cn("relative mt-0.5", TOOL_ICON_FRAME_CLASS, "bg-muted")} aria-label={t("a11y.toolSuccess")} role="img">
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
    <span className={cn("relative mt-0.5", TOOL_ICON_FRAME_CLASS, "bg-secondary")} aria-label={t("a11y.toolRunning")} role="img">
      <ToolGlyph className={cn(TOOL_ICON_GLYPH_CLASS, "text-focus")} strokeWidth={2.25} />
      <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-focus" />
    </span>
  );
}

type PanelTab = "activity" | "files" | "preview";

export function SandboxPreviewPanel({ previewSession }: { readonly previewSession: PreviewSession | null }) {
  const { t } = useTranslation();
  const [frameKey, setFrameKey] = useState(0);
  const url = previewSession?.active ? previewSession.url : undefined;
  const hostLabel = previewSession?.port ? `:${previewSession.port}` : previewSession?.directory;

  const handleReload = useCallback(() => {
    setFrameKey((value) => value + 1);
  }, []);

  const handleOpen = useCallback(() => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [url]);

  if (!previewSession?.active) {
    return (
      <EmptyState
        icon={PanelTop}
        description={t("preview.inactive")}
        className="h-full"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <PanelTop className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium text-foreground">
              {t("preview.title")}
            </span>
            {hostLabel && (
              <span className="status-pill status-neutral shrink-0 font-mono text-micro">
                {hostLabel}
              </span>
            )}
          </div>
          {previewSession.directory && (
            <p className="mt-0.5 truncate font-mono text-micro text-muted-foreground">
              {previewSession.directory}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("preview.reload")}
          onClick={handleReload}
          disabled={!url}
          className="shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("preview.open")}
          onClick={handleOpen}
          disabled={!url}
          className="shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      {url ? (
        <div className="min-h-0 flex-1 bg-muted p-2">
          <iframe
            key={frameKey}
            src={url}
            title={t("preview.frameTitle")}
            className="h-full min-h-[18rem] w-full rounded-md border border-border bg-background"
            referrerPolicy="no-referrer"
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
          />
        </div>
      ) : (
        <EmptyState
          icon={PanelTop}
          description={t("preview.noUrl")}
          className="h-full"
        />
      )}
    </div>
  );
}

interface AgentComputerPanelProps {
  conversationId: string | null;
  toolCalls: readonly ToolCallInfo[];
  agentStatuses: readonly AgentStatus[];
  artifacts: readonly ArtifactInfo[];
  previewSession?: PreviewSession | null;
  taskState: TaskState;
  highlightedStepId?: string | null;
  onClose?: () => void;
}

export function AgentComputerPanel({
  conversationId,
  toolCalls,
  agentStatuses,
  artifacts,
  previewSession = null,
  taskState,
  highlightedStepId,
  onClose,
}: AgentComputerPanelProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const activityContentRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("activity");
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const previousPreviewKeyRef = useRef<string | null>(null);
  const visibleArtifacts = useSessionFilteredArtifacts(artifacts);
  const hasArtifacts = visibleArtifacts.length > 0;
  const panelTabs = useMemo<readonly PanelTab[]>(
    () => {
      const tabs: PanelTab[] = ["activity"];
      if (previewSession?.active) tabs.push("preview");
      if (hasArtifacts) tabs.push("files");
      return tabs;
    },
    [hasArtifacts, previewSession?.active],
  );

  useEffect(() => {
    if (!panelTabs.includes(activeTab)) {
      setActiveTab("activity");
    }
  }, [activeTab, panelTabs]);

  useEffect(() => {
    const previewKey = previewSession?.active
      ? `${previewSession.url ?? ""}:${previewSession.port ?? ""}:${previewSession.directory ?? ""}`
      : null;
    if (previewKey && previewKey !== previousPreviewKeyRef.current) {
      setActiveTab("preview");
    }
    previousPreviewKeyRef.current = previewKey;
  }, [previewSession?.active, previewSession?.directory, previewSession?.port, previewSession?.url]);

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
        const agentToolEls = contentRef.current?.querySelectorAll<HTMLElement>("[data-agent-tool-anchor='true']") ?? [];
        let bestAgentToolMatch: HTMLElement | undefined;
        let bestAgentToolOwnerLength = -1;
        for (const candidate of agentToolEls) {
          const ownerId = candidate.getAttribute("data-agent-tool-owner");
          if (
            highlightedStepTargetsAgent(highlightedStepId, ownerId)
            && ownerId
            && ownerId.length > bestAgentToolOwnerLength
          ) {
            bestAgentToolMatch = candidate;
            bestAgentToolOwnerLength = ownerId.length;
          }
        }
        el = bestAgentToolMatch;
      }
      if (!el && highlightedStepId.startsWith("agent-")) {
        // agentId may contain dashes; row id may be agent-{id}-{timestamp}
        const allStepEls = contentRef.current?.querySelectorAll("[data-step-id]") ?? [];
        for (const candidate of allStepEls) {
          const sid = candidate.getAttribute("data-step-id") ?? "";
          if (
            sid.startsWith("agent-")
            && (highlightedStepId.startsWith(sid) || sid.startsWith(`${highlightedStepId}-`))
          ) {
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

      const currentIndex = panelTabs.indexOf(activeTab);
      const nextIndex =
        e.key === "ArrowRight"
          ? (currentIndex + 1) % panelTabs.length
          : (currentIndex - 1 + panelTabs.length) % panelTabs.length;

      const nextTab = panelTabs[nextIndex] ?? "activity";
      setActiveTab(nextTab);

      const nextButton = tabListRef.current?.querySelector<HTMLElement>(
        `#tab-${nextTab}`,
      );
      nextButton?.focus();
    },
    [activeTab, panelTabs],
  );

  const visibleToolCalls = useMemo(
    () => toolCalls.filter((t) => !HIDDEN_ACTIVITY_TOOLS.has(t.name)),
    [toolCalls],
  );

  // Agents that already have tool activity are represented by those tools on the unified timeline.
  const agentIdsWithToolActivity = useMemo(() => {
    const ids = new Set<string>();
    for (const tc of visibleToolCalls) {
      if (tc.agentId) ids.add(tc.agentId);
    }
    return ids;
  }, [visibleToolCalls]);

  const firstToolIdByAgentId = useMemo(() => {
    const ids = new Map<string, string>();
    for (const toolCall of visibleToolCalls) {
      if (toolCall.agentId && !ids.has(toolCall.agentId)) {
        ids.set(toolCall.agentId, toolCall.id);
      }
    }
    return ids;
  }, [visibleToolCalls]);

  // Unified timeline: all tool calls (parent + sub-agents) sorted by timestamp, plus status-only agent rows.
  type TimelineItem =
    | { readonly kind: "tool"; readonly toolCall: ToolCallInfo }
    | { readonly kind: "agent"; readonly agent: AgentStatus };

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = visibleToolCalls.map((toolCall) => ({ kind: "tool", toolCall }));
    for (const agent of agentStatuses) {
      if (!agentIdsWithToolActivity.has(agent.agentId)) {
        items.push({ kind: "agent", agent });
      }
    }
    items.sort((a, b) => {
      const tsA = a.kind === "tool" ? a.toolCall.timestamp : a.agent.timestamp;
      const tsB = b.kind === "tool" ? b.toolCall.timestamp : b.agent.timestamp;
      if (tsA !== tsB) return tsA - tsB;
      const keyA = a.kind === "tool" ? a.toolCall.id : `agent:${a.agent.agentId}:${a.agent.timestamp}`;
      const keyB = b.kind === "tool" ? b.toolCall.id : `agent:${b.agent.agentId}:${b.agent.timestamp}`;
      return keyA.localeCompare(keyB);
    });
    return items;
  }, [visibleToolCalls, agentStatuses, agentIdsWithToolActivity]);

  // Map agentId → human-readable name for display in wait/send tool calls
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentStatuses) {
      if (agent.name) {
        map.set(agent.agentId, normalizeAgentName(agent.name));
      }
    }
    return map;
  }, [agentStatuses]);

  useStickyBottom(contentRef, {
    enabled: activeTab === "activity",
    contentRef: activityContentRef,
  });
  const latestToolCall = visibleToolCalls[visibleToolCalls.length - 1];
  const isRunning = isTaskStateLive(taskState);

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
    <div lang="en" className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="shrink-0 bg-background">
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
              className="shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
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
              "relative flex items-center gap-1.5 px-2.5 pb-2 pt-1 label-mono transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              activeTab === "activity"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Activity className="h-4 w-4" aria-hidden="true" />
            {t("computer.activity")}
            {activeTab === "activity" && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-focus" />}
          </button>
          {previewSession?.active && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "preview"}
              aria-controls="panel-preview"
              id="tab-preview"
              tabIndex={activeTab === "preview" ? 0 : -1}
              onClick={() => setActiveTab("preview")}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 pb-2 pt-1 label-mono transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                activeTab === "preview"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PanelTop className="h-4 w-4" aria-hidden="true" />
              {t("preview.tab")}
              {activeTab === "preview" && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-focus" />}
            </button>
          )}
          {hasArtifacts && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "files"}
              aria-controls="panel-files"
              id="tab-files"
              tabIndex={activeTab === "files" ? 0 : -1}
              onClick={() => setActiveTab("files")}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 pb-2 pt-1 label-mono transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                activeTab === "files"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              {t("computer.artifacts")}
              <span
                className={cn(
                  "ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md px-1.5 text-micro font-semibold tabular-nums transition-colors chip-muted",
                  activeTab === "files" && "border border-border",
                )}
              >
                {visibleArtifacts.length}
              </span>
              {activeTab === "files" && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-focus" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Files tab ── */}
      {activeTab === "files" && hasArtifacts && (
        <div id="panel-files" role="tabpanel" aria-labelledby="tab-files" className="flex-1 overflow-y-auto">
          <ArtifactFilesPanel artifacts={visibleArtifacts} conversationId={conversationId} />
        </div>
      )}

      {/* ── Preview tab ── */}
      {activeTab === "preview" && previewSession?.active && (
        <div id="panel-preview" role="tabpanel" aria-labelledby="tab-preview" className="min-h-0 flex-1">
          <SandboxPreviewPanel previewSession={previewSession} />
        </div>
      )}

      {/* ── Activity content area — terminal-style logs ── */}
      {activeTab === "activity" && (
        <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" className="flex min-h-0 flex-1 flex-col bg-background">
          <div role="status" aria-live="polite" className="sr-only">
            {isRunning && latestToolCall
              ? getRunningToolStatusText(latestToolCall, t)
              : taskState === "complete"
                ? t("computer.statusDone")
                : taskState === "error"
                  ? t("computer.statusError")
                  : ""}
          </div>
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
            <div ref={activityContentRef} className="space-y-2">
              {timelineItems.map((item) =>
                item.kind === "agent" ? (
                  <div
                    key={`agent-${item.agent.agentId}-${item.agent.timestamp}`}
                    data-step-id={`agent-${item.agent.agentId}-${item.agent.timestamp}`}
                  >
                    <AgentStatusRow
                      agent={item.agent}
                      variant="light"
                      conversationId={conversationId}
                      agentNameMap={agentNameMap}
                    />
                  </div>
                ) : (() => {
                  const tc = item.toolCall;
                  const agentId = tc.agentId;
                  const agentLabel = agentId
                    ? (agentNameMap.get(agentId) || agentId.slice(0, 8))
                    : null;
                  const scopedWrap = Boolean(agentId);
                  const isFirstAgentTool = Boolean(
                    agentId && firstToolIdByAgentId.get(agentId) === tc.id,
                  );
                  const agentHighlighted = highlightedStepTargetsAgent(activeHighlight, agentId);

                  if (SKILL_TOOL_NAMES.has(tc.name)) {
                    return (
                      <div
                        key={tc.id}
                        className={cn(
                          scopedWrap && "border-l-2 border-border pl-3",
                          isFirstAgentTool && agentHighlighted && "rounded-lg bg-secondary",
                        )}
                        data-step-id={`tool-${tc.id}`}
                        data-agent-tool-owner={agentId || undefined}
                        data-agent-tool-anchor={isFirstAgentTool ? "true" : undefined}
                      >
                        {agentLabel && (
                          <div className="mb-1 flex items-center gap-1.5 text-micro text-muted-foreground">
                            <GitFork className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="truncate">{agentLabel}</span>
                          </div>
                        )}
                        <SkillActivityEntry toolCall={tc} />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={tc.id}
                      className={cn(
                        scopedWrap && "border-l-2 border-border pl-3",
                        isFirstAgentTool && agentHighlighted && "rounded-lg bg-secondary",
                      )}
                      data-step-id={`tool-${tc.id}`}
                      data-agent-tool-owner={agentId || undefined}
                      data-agent-tool-anchor={isFirstAgentTool ? "true" : undefined}
                    >
                      {agentLabel && (
                        <div className="mb-1 flex items-center gap-1.5 text-micro text-muted-foreground">
                          <GitFork className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{agentLabel}</span>
                        </div>
                      )}
                      <ActivityTimelineToolCallRow
                        toolCall={tc}
                        activeHighlight={activeHighlight}
                        conversationId={conversationId}
                        agentNameMap={agentNameMap}
                      />
                    </div>
                  );
                })()
              )}
            </div>
          </div>

          {/* ── Consolidated status bar ── */}
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 bg-background px-3 py-2.5">
            <Progress
              value={progressValue}
              className="h-2 min-w-[6rem] flex-1 rounded-full bg-muted"
              indicatorClassName={getTaskStateProgressIndicatorClass(taskState)}
            />

            <div
              className={cn(
                "status-pill shrink-0 px-2 py-1",
                isRunning
                  ? "status-info"
                  : taskState === "complete"
                    ? "status-primary"
                    : taskState === "error"
                      ? "status-error"
                      : "status-neutral",
              )}
            >
              {isRunning ? (
                <PulsingDot size="sm" />
              ) : taskState === "complete" ? (
                <CircleCheck className="h-3 w-3" />
              ) : taskState === "error" ? (
                <CircleX className="h-3 w-3 text-destructive" />
              ) : null}
              <span className="label-mono">
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
