"use client";

import { useState, useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
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

const SEARCH_LIKE_TOOLS = new Set([
  "web_search",
  "file_search",
  "memory_search",
  "browser_use",
]);

const PARSE_LIKE_TOOLS = new Set([
  "web_fetch",
  "document_read",
  "file_read",
  "database_query",
]);

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

function truncateRuntimeValue(value: string, maxLength = 48): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function extractHostname(url: unknown): string | undefined {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function firstInputValue(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const raw = input[key];
    if (typeof raw === "string" && raw.trim()) {
      return truncateRuntimeValue(raw);
    }
  }
  return undefined;
}

function resolveSearchTarget(input: Record<string, unknown>, fallback: string, t: TFn): string {
  const fromUrl = extractHostname(input.url);
  if (fromUrl) return fromUrl;
  const value =
    firstInputValue(input, ["query", "pattern", "task", "target", "keyword", "text"]) ??
    truncateRuntimeValue(fallback);
  return value || t("progress.runtimeUnknown");
}

function resolveParseTarget(input: Record<string, unknown>, fallback: string, t: TFn): string {
  const fromUrl = extractHostname(input.url);
  if (fromUrl) return fromUrl;
  const value =
    firstInputValue(input, ["path", "filePath", "filename", "query", "task", "target", "url"]) ??
    truncateRuntimeValue(fallback);
  return value || t("progress.runtimeUnknown");
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
  const updateSkillStepStatus = (
    skillName: string,
    status: "complete" | "error",
    timestamp: number,
  ) => {
    const normalized = normalizeSkillName(skillName);
    let updated = false;
    steps = steps.map((step, idx, arr) => {
      if (
        updated
        || step.kind !== "skill"
        || step.name !== normalized
        || arr.slice(idx + 1).some((candidate) => candidate.kind === "skill" && candidate.name === normalized)
      ) {
        return step;
      }
      updated = true;
      return { ...step, status };
    });
    if (!updated) {
      steps = [...steps, {
        id: `skill-${skillName}-${timestamp}`,
        kind: "skill",
        title: t("progress.loadingSkills", { name: normalized }),
        name: normalized,
        status,
      }];
    }
  };

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
          } else {
            const normalizedToolName = normalizeToolNameI18n(toolName, t);
            displayName = isSkill
              ? normalizeSkillName(String(input.name ?? "skill"))
              : normalizedToolName;

            if (isSkill) {
              stepTitle = t("progress.loadingSkills", { name: displayName });
            } else if (SEARCH_LIKE_TOOLS.has(toolName)) {
              const target = resolveSearchTarget(input, normalizedToolName, t);
              displayName = target;
              stepTitle = t("progress.searchingTarget", { target });
            } else if (PARSE_LIKE_TOOLS.has(toolName)) {
              const target = resolveParseTarget(input, normalizedToolName, t);
              displayName = target;
              stepTitle = t("progress.parsingContent", { target });
            } else {
              stepTitle = t("progress.usingTool", { name: displayName });
            }
          }

          steps = [...steps, {
            id: tc ? `tool-${tc.id}` : `tool-${apiToolId}-${ord}-${event.timestamp}`,
            kind: isSkill ? "skill" : "tool",
            title: stepTitle,
            name: displayName,
            rawToolName: toolName,
            status: isSkill
              ? tc?.success === false
                ? "error"
                : tc?.success === true
                  ? "complete"
                  : "running"
              : tc?.output !== undefined
                ? "complete"
                : "running",
          }];
        }
        break;
      }

      case "skill_activated": {
        const skillName = String(event.data.name ?? "").trim();
        if (skillName) {
          updateSkillStepStatus(skillName, "complete", event.timestamp);
        }
        break;
      }

      case "skill_setup_failed": {
        const skillName = String(event.data.name ?? "").trim();
        if (skillName) {
          updateSkillStepStatus(skillName, "error", event.timestamp);
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
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="absolute inset-0 rounded-full bg-muted animate-[pulsingDotFade_2s_ease-in-out_infinite]" />
      </span>
    );
  }

  if (step.status === "error") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
        <CircleX className="h-3.5 w-3.5 text-accent-rose" />
      </span>
    );
  }

  // complete
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
      <Check className="h-3.5 w-3.5 text-accent-emerald" />
    </span>
  );
}

/* State badge shown next to the title */
function TaskStateBadge({ state, t }: { readonly state: TaskState; readonly t: TFn }) {
  switch (state) {
    case "planning":
      return (
        <span className="status-pill chip-muted">
          <Lightbulb className="h-3 w-3" />
          {t("progress.statePlanning")}
        </span>
      );
    case "executing":
      return (
        <span className="status-pill chip-muted">
          <PulsingDot size="sm" />
          {t("progress.stateExecuting")}
        </span>
      );
    case "complete":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-accent-emerald/10 px-1.5 py-0.5 text-micro font-medium text-accent-emerald">
          <CircleCheck className="h-3 w-3 text-accent-emerald" />
          {t("progress.stateComplete")}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-accent-rose/10 px-1.5 py-0.5 text-micro font-medium text-accent-rose">
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
      className="surface-panel overflow-hidden"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {runningStepTitle ? `${taskStateAnnouncement}: ${runningStepTitle}` : taskStateAnnouncement}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            aria-label={panelOpen ? t("progress.closePanel") : t("progress.openPanel")}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">{t("progress.title")}</span>
          <TaskStateBadge state={taskState} t={t} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums font-mono text-caption font-medium text-muted-foreground">{completedCount}/{totalCount}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? t("a11y.collapse") : t("a11y.expand")}
            onClick={() => setExpanded((prev) => !prev)}
            className="text-muted-foreground hover:text-foreground"
          >
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex items-center"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </motion.span>
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <Progress
          value={progressPercent}
          className="h-1 rounded-full bg-border/50"
          indicatorClassName={cn(
            taskState === "complete" && "bg-accent-emerald",
            taskState === "error" && "bg-accent-rose",
            taskState === "planning" && "bg-muted-foreground",
            (taskState === "executing" || taskState === "idle") && "bg-foreground",
          )}
          aria-label={t("progress.taskProgress", { percent: progressPercent })}
        />

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 max-h-60 space-y-0.5 overflow-y-auto text-sm">
                  {steps.map((step, index) => {
                    const isClickable = isTimelineStepActionable(step.id);
                    const rowClassName = cn(
                      "flex items-start gap-2.5 rounded-md px-1.5 py-1.5",
                      isClickable && "cursor-pointer transition-colors hover:bg-muted/20",
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
              </motion.div>
            )}
          </AnimatePresence>
      </div>
    </motion.div>
  );
}
