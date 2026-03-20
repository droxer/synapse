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
import { formatToolPreview } from "../lib/format-tools";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import { HIDDEN_ACTIVITY_TOOLS, normalizeToolName, normalizeToolNameI18n } from "../lib/tool-constants";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { SkillActivityEntry } from "./SkillActivityEntry";
import { AgentStatusRow } from "./AgentStatusRow";
import { ArtifactFilesPanel } from "./ArtifactFilesPanel";
import { EmptyState } from "@/shared/components/EmptyState";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { ToolCallInfo, AgentStatus, TaskState, ArtifactInfo, ComputerUseMetadata } from "@/shared/types";

const SKILL_TOOL_NAMES = new Set(["activate_skill", "load_skill"]);

type TFn = (key: string, params?: Record<string, string | number>) => string;

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
    <div className="ml-6 mb-1 rounded-md border border-border bg-secondary/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <GitFork className="h-3.5 w-3.5 shrink-0 text-accent-purple" />
        <span className="text-sm font-medium text-foreground">{agentName}</span>
        {role && (
          <span className="rounded-full bg-accent-purple/10 px-2 py-0.5 text-micro font-medium text-accent-purple">
            {role}
          </span>
        )}
      </div>
      {taskDesc && (
        <p className="mt-1 ml-5.5 text-xs text-muted-foreground leading-relaxed">
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
    <div className="ml-6 mb-1 rounded-md border border-border bg-secondary/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 shrink-0 text-accent-amber" />
        <span className="text-sm font-medium text-foreground">
          {waitingAll
            ? t("computer.waitingAllAgents")
            : t("computer.waitingAgents", { count: agentIds.length })}
        </span>
      </div>
      {!waitingAll && (
        <div className="mt-1 ml-5.5 flex flex-wrap gap-1.5">
          {agentIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground"
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
    <div className="ml-6 mb-1 rounded-md border border-border bg-secondary/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-accent-purple" />
        <span className="text-sm font-medium text-foreground">
          {isBroadcast
            ? t("computer.broadcastMessage")
            : t("computer.sendToAgent", { id: agentNameMap.get(targetId) || targetId.slice(0, 8) })}
        </span>
      </div>
      {message && (
        <p className="mt-1 ml-5.5 text-xs text-muted-foreground leading-relaxed">
          {message.length > 200 ? message.slice(0, 197) + "..." : message}
        </p>
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
  if (tc.output !== undefined) {
    return tc.success === false
      ? <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" />
      : <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" />;
  }
  return <PulsingDot size="sm" />;
}

type PanelTab = "activity" | "files";

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
  const [activeTab, setActiveTab] = useState<PanelTab>("activity");
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);

  const TABS: PanelTab[] = ["activity", "files"];

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
        // Extract agentId from "agent-{agentId}-{timestamp}"
        const parts = highlightedStepId.split("-");
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
    const timer = setTimeout(() => setActiveHighlight(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightedStepId]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();

      const currentIndex = TABS.indexOf(activeTab);
      const nextIndex =
        e.key === "ArrowRight"
          ? (currentIndex + 1) % TABS.length
          : (currentIndex - 1 + TABS.length) % TABS.length;

      const nextTab = TABS[nextIndex];
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
    contentRef.current?.scrollTo({
      top: contentRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleToolCalls]);
  const latestToolCall = visibleToolCalls[visibleToolCalls.length - 1];
  const isRunning = taskState === "executing" || taskState === "planning";

  const completedCount = useMemo(
    () => visibleToolCalls.filter((t) => t.output !== undefined).length,
    [visibleToolCalls],
  );

  const progressValue = useMemo(() => {
    if (taskState === "complete") return 100;
    if (taskState === "idle" || visibleToolCalls.length === 0) return 0;
    return Math.min(95, (completedCount / Math.max(1, visibleToolCalls.length)) * 100);
  }, [taskState, visibleToolCalls.length, completedCount]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header with tabs ── */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-4 pt-3 pb-0">
          <span className="text-base font-semibold tracking-tight text-foreground">
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
        <div ref={tabListRef} className="flex gap-1 px-3 pt-2 sm:px-4" role="tablist" aria-label={t("computer.tabsLabel")} onKeyDown={handleTabKeyDown}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            aria-controls="panel-activity"
            id="tab-activity"
            tabIndex={activeTab === "activity" ? 0 : -1}
            onClick={() => setActiveTab("activity")}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              activeTab === "activity"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Monitor className="h-3 w-3" />
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
              "flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              activeTab === "files"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderOpen className="h-3 w-3" />
            {t("computer.artifacts")}
            {artifacts.length > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-micro font-semibold">
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
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2" role="status" aria-live="polite">
          <PulsingDot size="sm" />
          <span className="text-base text-muted-foreground">
            {SKILL_TOOL_NAMES.has(latestToolCall.name)
              ? t("computer.loadingSkill", { name: normalizeSkillName(String(latestToolCall.input.name ?? "skill")) })
              : latestToolCall.name === "browser_use"
                ? getBrowserStatusText(latestToolCall, t)
                : COMPUTER_USE_TOOLS.has(latestToolCall.name)
                  ? getComputerUseStatusText(latestToolCall, t)
                  : latestToolCall.name === "agent_spawn"
                    ? t("computer.spawningAgent", { name: String(latestToolCall.input.name ?? "agent") })
                    : latestToolCall.name === "agent_wait"
                      ? t("computer.waitingForAgents")
                      : latestToolCall.name === "agent_send"
                        ? t("computer.sendingMessage")
                        : t("computer.usingTool", { verb: getToolVerb(latestToolCall.name, t) })}
          </span>
          {latestToolCall.output === undefined && !SKILL_TOOL_NAMES.has(latestToolCall.name) && latestToolCall.name !== "browser_use" && !COMPUTER_USE_TOOLS.has(latestToolCall.name) && !AGENT_META_TOOLS.has(latestToolCall.name) && (
            <span className="ml-auto max-w-[240px] truncate font-mono text-sm text-muted-foreground-dim">
              {formatToolPreview(latestToolCall.input)}
            </span>
          )}
        </div>
      )}

      {/* ── Activity content area — terminal-style logs ── */}
      {activeTab === "activity" && (
        <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" className="flex min-h-0 flex-1 flex-col">
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto px-4 py-4 sm:px-6"
          >
            {/* Empty state */}
            {visibleToolCalls.length === 0 && (
              <EmptyState
                icon={Monitor}
                description={t("computer.waitingActivity")}
                className="h-full"
              />
            )}

            {/* Unified timeline: tool calls and agent status rows interleaved by timestamp */}
            <div className="space-y-2 font-mono text-sm">
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
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="rounded-md"
                  >
                    {/* Log line */}
                    <div className="flex items-start gap-2 py-1.5">
                      <StatusIcon tc={item.toolCall} />
                      {item.toolCall.name === "browser_use" ? (
                        <>
                          <span className="text-foreground">
                            {getBrowserStatusText(item.toolCall, t)}
                          </span>
                          {item.toolCall.output === undefined && (
                            <span className="text-ai-glow">
                              {t("computer.running")}
                            </span>
                          )}
                        </>
                      ) : COMPUTER_USE_TOOLS.has(item.toolCall.name) ? (
                        <>
                          <span className="text-foreground">
                            {getComputerUseStatusText(item.toolCall, t)}
                          </span>
                          {item.toolCall.output === undefined && (
                            <span className="text-ai-glow">
                              {t("computer.running")}
                            </span>
                          )}
                        </>
                      ) : AGENT_META_TOOLS.has(item.toolCall.name) ? (
                        <>
                          <span className="text-foreground">
                            {normalizeToolNameI18n(item.toolCall.name, t)}
                          </span>
                          {item.toolCall.output === undefined && (
                            <span className="text-ai-glow">
                              {t("computer.running")}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-foreground">
                            {normalizeToolNameI18n(item.toolCall.name, t)}
                          </span>
                          {item.toolCall.output === undefined && (
                            <span className="text-ai-glow">
                              {t("computer.running")}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Polished agent meta tool display */}
                    {AGENT_META_TOOLS.has(item.toolCall.name) && (
                      <AgentMetaDisplay tc={item.toolCall} t={t} agentNameMap={agentNameMap} />
                    )}

                    {/* Args detail box — skip for browser_use, computer_use, and agent_spawn (have custom displays) */}
                    {Object.keys(item.toolCall.input).length > 0 && item.toolCall.name !== "browser_use" && !COMPUTER_USE_TOOLS.has(item.toolCall.name) && !AGENT_META_TOOLS.has(item.toolCall.name) && (
                      <div className="ml-6 mb-1">
                        <ToolArgsDisplay input={item.toolCall.input} />
                      </div>
                    )}

                    {/* Output (collapsible) */}
                    {item.toolCall.output !== undefined && (
                      <div className="ml-6 mb-2">
                        <ToolOutputRenderer
                          output={item.toolCall.output}
                          toolName={item.toolCall.name}
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
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2">
            <Progress value={progressValue} className="flex-1 h-1" />

            <div className="flex items-center gap-1.5">
              {isRunning ? (
                <PulsingDot size="sm" />
              ) : taskState === "complete" ? (
                <CircleCheck className="h-3.5 w-3.5 text-accent-emerald" />
              ) : taskState === "error" ? (
                <CircleX className="h-3.5 w-3.5 text-accent-rose" />
              ) : null}
              <span className="text-xs font-medium text-muted-foreground">
                {taskState === "complete"
                  ? t("computer.statusDone")
                  : isRunning
                    ? t("computer.statusLive")
                    : taskState === "error"
                      ? t("computer.statusError")
                      : t("computer.statusIdle")}
              </span>
            </div>

            <span className="text-xs font-mono font-medium text-muted-foreground tabular-nums">
              {completedCount}/{visibleToolCalls.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
