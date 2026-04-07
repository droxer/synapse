"use client";

import { useState, useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  PanelRightOpen,
  PanelRightClose,
  CircleCheck,
  CircleX,
  Lightbulb,
  Play,
  Code,
  FileText,
  Globe,
  Database,
  Eye,
  Bot,
  Flag,
  AlertTriangle,
  Wrench,
  Plug,
  Monitor,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { AgentEvent, AgentStatus, TaskState, ToolCallInfo } from "@/shared/types";
import { computeAgentTaskProgressPercent } from "@/features/agent-computer/lib/agent-task-progress";
import { normalizeToolNameI18n, normalizeAgentName, getToolCategory } from "@/features/agent-computer/lib/tool-constants";
import type { ToolCategory } from "@/features/agent-computer/lib/tool-constants";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import type { TFn } from "@/shared/types/i18n";

interface AgentProgressCardProps {
  events: AgentEvent[];
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  taskState: TaskState;
  onClick?: () => void;
  onStepClick?: (stepId: string) => void;
  panelOpen?: boolean;
}

type StepKind = "start" | "tool" | "skill" | "agent" | "complete" | "error";

interface TimelineStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly title: string;
  /** The tool, skill, or agent name — rendered with emphasis when present */
  readonly name?: string;
  /** Raw tool name for category-based icon lookup */
  readonly rawToolName?: string;
  readonly status: "running" | "complete" | "error";
  /** Sub-agent row: tool count under this agent (suffix via i18n when > 0) */
  readonly agentToolCount?: number;
}

interface ToolCallIndexes {
  readonly byToolUseId: ReadonlyMap<string, readonly ToolCallInfo[]>;
  readonly countByAgentId: ReadonlyMap<string, number>;
}

export function buildToolCallIndexes(toolCalls: readonly ToolCallInfo[]): ToolCallIndexes {
  const byToolUseId = new Map<string, ToolCallInfo[]>();
  const countByAgentId = new Map<string, number>();

  for (const toolCall of toolCalls) {
    const existingForId = byToolUseId.get(toolCall.toolUseId);
    if (existingForId) {
      existingForId.push(toolCall);
    } else {
      byToolUseId.set(toolCall.toolUseId, [toolCall]);
    }

    if (toolCall.agentId) {
      countByAgentId.set(toolCall.agentId, (countByAgentId.get(toolCall.agentId) ?? 0) + 1);
    }
  }

  return { byToolUseId, countByAgentId };
}

function agentDisplayTitle(
  eventData: Record<string, unknown>,
  agentId: string,
  agentNameMap: ReadonlyMap<string, string>,
): string {
  const fromEvent = String(eventData.name || eventData.description || "").trim();
  const mapped = agentNameMap.get(agentId)?.trim();
  const base = mapped || fromEvent || "working";
  return normalizeAgentName(base).slice(0, 55);
}

export function buildSteps(
  events: AgentEvent[],
  indexes: ToolCallIndexes,
  t: TFn,
  agentNameMap: ReadonlyMap<string, string>,
): TimelineStep[] {
  let steps: TimelineStep[] = [];
  /** Deduplicate by (api tool id + ordinal), since providers may reuse ids across turns. */
  const seenToolCalls = new Set<string>();
  const toolCallOrdinalByApiId = new Map<string, number>();

  for (const event of events) {
    switch (event.type) {
      case "task_start":
        steps = [...steps, {
          id: `start-${event.timestamp}`,
          kind: "start",
          title: t("progress.taskStarted"),
          status: "complete",
        }];
        break;


      case "tool_call": {
        const toolName = String(event.data.name ?? event.data.tool_name ?? "unknown");
        const apiToolId = String(event.data.tool_id ?? event.data.id ?? event.timestamp);
        const ord = toolCallOrdinalByApiId.get(apiToolId) ?? 0;
        toolCallOrdinalByApiId.set(apiToolId, ord + 1);
        const dedupeKey = `${apiToolId}#${ord}`;
        if (!seenToolCalls.has(dedupeKey)) {
          seenToolCalls.add(dedupeKey);
          const sameApiCalls = indexes.byToolUseId.get(apiToolId) ?? [];
          const tc = sameApiCalls[ord];
          const isSkill = toolName === "activate_skill" || toolName === "load_skill";
          const input = (event.data.input ?? event.data.tool_input ?? event.data.arguments ?? {}) as Record<string, unknown>;
          const isBrowser = toolName === "browser_use";

          // Build display name and step title
          let displayName: string;
          let stepTitle: string;

          const isComputer = toolName === "computer_action" || toolName === "computer_screenshot";

          if (isComputer) {
            // Computer use: "Desktop click (640, 480)" or "Desktop screenshot"
            const action = typeof input.action === "string" ? input.action : undefined;
            if (toolName === "computer_screenshot" || !action) {
              displayName = t("output.category.computer");
              stepTitle = t("progress.desktopAction", { action: "screenshot" });
            } else {
              const x = typeof input.x === "number" ? input.x : undefined;
              const y = typeof input.y === "number" ? input.y : undefined;
              const coords = x != null && y != null ? ` (${x}, ${y})` : "";
              displayName = t("output.category.computer");
              stepTitle = t("progress.desktopAction", { action: action.replace(/_/g, " ") + coords });
            }
          } else if (isBrowser) {
            // Browser: "Browsing www.taobao.com" or "Browsing: task text"
            let target = "";
            if (typeof input.url === "string") {
              try { target = new URL(String(input.url)).hostname; } catch { /* ignore */ }
            }
            if (!target && typeof input.task === "string") {
              const taskStr = String(input.task);
              target = taskStr.length > 40 ? taskStr.slice(0, 37) + "..." : taskStr;
            }
            displayName = target || "web";
            stepTitle = t("progress.browsing", { target: displayName });
            // Append step count for completed browser_use
            if (tc?.output !== undefined && tc.browserMetadata?.steps) {
              stepTitle += ` (${t("progress.browsingSteps", { count: tc.browserMetadata.steps })})`;
            }
          } else {
            displayName = isSkill
              ? normalizeSkillName(String(input.name ?? "skill"))
              : normalizeToolNameI18n(toolName, t);
            stepTitle = isSkill
              ? t("progress.loadingSkill", { name: displayName })
              : t("progress.usingTool", { name: displayName });
          }

          steps = [...steps, {
            id: tc ? `tool-${tc.id}` : `tool-${apiToolId}-${ord}-${event.timestamp}`,
            kind: isSkill ? "skill" : "tool",
            title: stepTitle,
            name: displayName,
            rawToolName: toolName,
            status: tc?.output !== undefined ? "complete" : "running",
          }];
        }
        break;
      }

      case "plan_created": {
        const planSteps = Array.isArray(event.data.steps) ? event.data.steps as unknown[] : [];
        steps = [...steps, {
          id: `plan-${event.timestamp}`,
          kind: "start",
          title: t("progress.planCreated", { count: planSteps.length }),
          status: "complete",
        }];
        break;
      }

      case "agent_spawn": {
        const spawnAgentId = String(event.data.agent_id ?? event.data.id ?? "");
        const agentToolCount = indexes.countByAgentId.get(spawnAgentId) ?? 0;
        const data = event.data as Record<string, unknown>;
        steps = [...steps, {
          id: `agent-${spawnAgentId}-${event.timestamp}`,
          kind: "agent",
          title: agentDisplayTitle(data, spawnAgentId, agentNameMap),
          agentToolCount: agentToolCount > 0 ? agentToolCount : undefined,
          status: "running",
        }];
        break;
      }

      case "agent_complete": {
        const agentId = String(event.data.agent_id ?? event.data.id ?? "");
        const completedToolCount = indexes.countByAgentId.get(agentId) ?? 0;
        const newStatus: TimelineStep["status"] = event.data.error ? "error" : "complete";
        steps = steps.map((s) =>
          s.id.startsWith("agent-") && s.id.includes(agentId)
            ? {
              ...s,
              status: newStatus,
              agentToolCount: completedToolCount > 0 ? completedToolCount : undefined,
            }
            : s
        );
        break;
      }

      case "task_complete":
        steps = [...steps, {
          id: `complete-${event.timestamp}`,
          kind: "complete",
          title: t("progress.taskComplete"),
          status: "complete",
        }];
        break;

      case "task_error":
        steps = [...steps, {
          id: `error-${event.timestamp}`,
          kind: "error",
          title: t("progress.error"),
          status: "error",
        }];
        break;
    }
  }


  return steps;
}

export function isTimelineStepActionable(stepId: string): boolean {
  return stepId.startsWith("tool-") || stepId.startsWith("agent-");
}

/** Emphasize `name` in `title` only on first occurrence; avoids split() edge cases. */
function StepTitleLine({
  title,
  name,
  statusClass,
}: {
  readonly title: string;
  readonly name?: string;
  readonly statusClass: string;
}): ReactNode {
  if (!name) return title;
  const idx = title.indexOf(name);
  if (idx === -1) return title;
  return (
    <>
      {title.slice(0, idx)}
      <span className={cn("font-semibold", statusClass)}>{name}</span>
      {title.slice(idx + name.length)}
    </>
  );
}

function AgentStepTitleLine({
  step,
  t,
  mainClass,
}: {
  readonly step: TimelineStep;
  readonly t: TFn;
  readonly mainClass: string;
}): ReactNode {
  const count = step.agentToolCount;
  return (
    <>
      <span className={mainClass}>{step.title}</span>
      {count != null && count > 0 && (
        <span className="font-normal text-muted-foreground">
          {" "}
          {step.status === "running"
            ? t("progress.agentToolsRunning", { count })
            : t("progress.agentToolsComplete", { count })}
        </span>
      )}
    </>
  );
}

/* Category-based icon for each tool kind */
function toolCategoryIcon(category: ToolCategory) {
  switch (category) {
    case "code": return Code;
    case "file": return FileText;
    case "search": return Globe;
    case "memory": return Database;
    case "browser": return Eye;
    case "computer": return Monitor;
    case "preview": return Eye;
    case "mcp": return Plug;
    default: return Wrench;
  }
}

function kindIcon(kind: StepKind, rawToolName?: string) {
  switch (kind) {
    case "start": return Play;
    case "skill": return Lightbulb;
    case "agent": return Bot;
    case "complete": return Flag;
    case "error": return AlertTriangle;
    case "tool": return rawToolName ? toolCategoryIcon(getToolCategory(rawToolName)) : Wrench;
  }
}

/* Icon + status-colored container for each step */
function StepIcon({ step }: { readonly step: TimelineStep }) {
  const Icon = kindIcon(step.kind, step.rawToolName);

  if (step.status === "running") {
    return (
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="absolute inset-0 rounded-md bg-muted animate-[pulsingDotFade_2s_ease-in-out_infinite]" />
      </span>
    );
  }

  if (step.status === "error") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-destructive/5">
        <CircleX className="h-3 w-3 text-accent-rose" />
      </span>
    );
  }

  // complete — swap category icon for a check
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-accent-emerald/30 bg-accent-emerald/10">
      <Check className="h-3 w-3 text-accent-emerald" />
    </span>
  );
}

/* State badge shown next to the title */
function TaskStateBadge({ state, t }: { readonly state: TaskState; readonly t: TFn }) {
  switch (state) {
    case "planning":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          <Lightbulb className="h-3 w-3" />
          {t("progress.statePlanning")}
        </span>
      );
    case "executing":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          <PulsingDot size="sm" />
          {t("progress.stateExecuting")}
        </span>
      );
    case "complete":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-accent-emerald/30 bg-accent-emerald/10 px-2 py-0.5 text-xs font-medium text-accent-emerald">
          <CircleCheck className="h-3 w-3 text-accent-emerald" />
          {t("progress.stateComplete")}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-rose/10 px-2 py-0.5 text-xs font-medium text-accent-rose">
          <CircleX className="h-3 w-3" />
          {t("progress.stateError")}
        </span>
      );
    default:
      return null;
  }
}

export function AgentProgressCard({
  events,
  toolCalls,
  agentStatuses,
  taskState,
  onClick,
  onStepClick,
  panelOpen = false,
}: AgentProgressCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const toolIndexes = useMemo(() => buildToolCallIndexes(toolCalls), [toolCalls]);

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentStatuses) {
      if (agent.name) map.set(agent.agentId, agent.name);
    }
    return map;
  }, [agentStatuses]);

  const steps = useMemo(
    () => buildSteps(events, toolIndexes, t, agentNameMap),
    [events, toolIndexes, t, agentNameMap],
  );

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const totalCount = steps.length;
  const isRunning = taskState === "executing";
  const progressPercent = useMemo(
    () => computeAgentTaskProgressPercent(taskState, completedCount, totalCount),
    [taskState, completedCount, totalCount],
  );

  const runningStepTitle = useMemo(() => {
    if (!isRunning) return undefined;
    const runningStep = [...steps].reverse().find((s) => s.status === "running");
    return runningStep?.title;
  }, [steps, isRunning]);

  if (totalCount === 0) return null;
  const taskStateAnnouncement =
    taskState === "planning"
      ? t("progress.statePlanning")
      : taskState === "executing"
        ? t("progress.stateExecuting")
        : taskState === "complete"
          ? t("progress.stateComplete")
          : taskState === "error"
            ? t("progress.stateError")
            : t("computer.statusIdle");

  return (
    <motion.div
      className="overflow-hidden rounded-lg border border-border bg-card hover:border-border-strong transition-colors"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {/* Progress bar */}
      <Progress
        value={progressPercent}
        className="h-1 rounded-none"
        indicatorClassName={cn(
          taskState === "complete" && "bg-accent-emerald",
          taskState === "error" && "bg-accent-rose",
          taskState === "planning" && "bg-muted-foreground",
          (taskState === "executing" || taskState === "idle") && "bg-foreground",
        )}
        aria-label={t("progress.taskProgress", { percent: progressPercent })}
      />

      {/* Unified header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div role="status" aria-live="polite" className="sr-only">
          {runningStepTitle ? `${taskStateAnnouncement}: ${runningStepTitle}` : taskStateAnnouncement}
        </div>
        {/* Left: clickable title area — toggles expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="group flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-foreground">
                {t("progress.title")}
              </span>
              <TaskStateBadge state={taskState} t={t} />
            </div>
            {runningStepTitle && (
              <div
                role="status"
                aria-live="polite"
                className="truncate text-sm text-muted-foreground"
              >
                {runningStepTitle}
              </div>
            )}
          </div>
          <span className="tabular-nums font-mono text-xs font-medium text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex items-center"
          >
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </motion.span>
        </button>

        {/* Right: panel toggle icon — opens/closes AgentComputerPanel */}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={panelOpen ? t("progress.closePanel") : t("progress.openPanel")}
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {panelOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Collapsible timeline — dot status indicators */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              <div className="max-h-60 overflow-y-auto font-mono text-sm">
                <div className="space-y-1.5">
                  {steps.map((step, index) => {
                    const isClickable = isTimelineStepActionable(step.id);
                    const rowClassName = cn(
                      "flex items-center gap-2.5 py-1.5 rounded-md px-1.5 -mx-1.5",
                      isClickable && "cursor-pointer hover:bg-muted transition-colors",
                      step.status === "complete" && "bg-accent-emerald/5",
                      isClickable &&
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    );
                    const rowContent = (
                      <>
                        <StepIcon step={step} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            step.status === "running" && "text-foreground",
                            step.status === "complete" && "text-foreground",
                            step.status === "error" && "text-accent-rose",
                          )}
                        >
                          {step.kind === "agent" ? (
                            <AgentStepTitleLine
                              step={step}
                              t={t}
                              mainClass={cn(
                                step.status === "running" && "text-foreground",
                                step.status === "complete" && "text-foreground",
                                step.status === "error" && "text-accent-rose",
                              )}
                            />
                          ) : step.name ? (
                            <StepTitleLine
                              title={step.title}
                              name={step.name}
                              statusClass={cn(
                                step.status === "running" && "text-foreground",
                                step.status === "complete" && "text-foreground",
                                step.status === "error" && "text-accent-rose",
                              )}
                            />
                          ) : (
                            step.title
                          )}
                        </span>
                      </>
                    );
                    return isClickable ? (
                      <motion.button
                        type="button"
                        key={step.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          delay: index * 0.015,
                          duration: 0.12,
                          ease: "easeOut",
                        }}
                        className={rowClassName}
                        onClick={() => onStepClick?.(step.id)}
                      >
                        {rowContent}
                      </motion.button>
                    ) : (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          delay: index * 0.015,
                          duration: 0.12,
                          ease: "easeOut",
                        }}
                        className={rowClassName}
                      >
                        {rowContent}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
