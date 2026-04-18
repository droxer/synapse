"use client";

import { useState, useMemo, useRef, useId, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Minus,
  Lightbulb,
  Play,
  Bot,
  Flag,
  AlertTriangle,
  Monitor,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { useStickyBottom } from "@/shared/hooks";
import type { AgentEvent, AgentStatus, TaskState, ToolCallInfo } from "@/shared/types";
import { computeAgentTaskProgressPercent } from "@/features/agent-computer/lib/agent-task-progress";
import {
  getTaskStateAnnouncement,
  getTaskStateProgressIndicatorClass,
  isTaskStateLive,
} from "@/features/agent-computer/lib/task-state-display";
import {
  HIDDEN_ACTIVITY_TOOLS,
  normalizeToolNameI18n,
  normalizeAgentName,
} from "@/features/agent-computer/lib/tool-constants";
import { getTimelineToolOrSkillIcon } from "@/features/agent-computer/lib/tool-visual-icons";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import type { TFn } from "@/shared/types/i18n";

interface AgentProgressCardProps {
  events: readonly AgentEvent[];
  toolCalls: readonly ToolCallInfo[];
  agentStatuses: readonly AgentStatus[];
  taskState: TaskState;
  isWaitingForAgent?: boolean;
  onClick?: () => void;
  onStepClick?: (stepId: string) => void;
  panelOpen?: boolean;
}

type StepKind = "start" | "tool" | "skill" | "agent" | "complete" | "error";
type TimelineStepStatus = "running" | "complete" | "error" | "skipped" | "replan_required";

interface TimelineStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly title: string;
  /** The tool, skill, or agent name — rendered with emphasis when present */
  readonly name?: string;
  /** Raw skill id from tool input / events — stable icon key */
  readonly skillKey?: string;
  /** Raw tool name for category-based icon lookup */
  readonly rawToolName?: string;
  readonly status: TimelineStepStatus;
  /** Sub-agent row: tool count under this agent (suffix via i18n when > 0) */
  readonly agentToolCount?: number;
}

interface StatusVisual {
  readonly text: string;
  readonly rowBase: string;
  readonly rowHover: string;
  readonly iconSurface: string;
  readonly iconColor: string;
}

interface ToolCallIndexes {
  readonly byToolUseId: ReadonlyMap<string, readonly ToolCallInfo[]>;
  readonly countByAgentId: ReadonlyMap<string, number>;
}

const STEP_ICON_FRAME_CLASS = "flex h-5 w-5 shrink-0 items-center justify-center rounded-md";
const STEP_ICON_GLYPH_CLASS = "h-3.5 w-3.5";

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
    if (HIDDEN_ACTIVITY_TOOLS.has(toolCall.name)) {
      continue;
    }
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

function mapAgentStepStatus(value: unknown): TimelineStepStatus {
  switch (value) {
    case "complete":
    case "skipped":
    case "replan_required":
    case "error":
      return value;
    default:
      return "error";
  }
}

function buildOptimisticSkillStep(toolCall: ToolCallInfo, t: TFn): TimelineStep {
  const skillName = normalizeSkillName(String(toolCall.input.name ?? "skill"));
  return {
    id: `tool-${toolCall.id}`,
    kind: "skill",
    title: t("progress.loadingSkill", { name: skillName }),
    name: skillName,
    skillKey: String(toolCall.input.name ?? "") || undefined,
    rawToolName: toolCall.name,
    status: "running",
  };
}

export function buildSteps(
  events: readonly AgentEvent[],
  indexes: ToolCallIndexes,
  toolCalls: readonly ToolCallInfo[],
  t: TFn,
  agentNameMap: ReadonlyMap<string, string>,
): TimelineStep[] {
  let steps: TimelineStep[] = [];
  const getSkillStepTitle = (
    skillName: string,
    status: TimelineStepStatus,
  ): string => {
    if (status === "complete") {
      return t("progress.skillLoaded", { name: skillName });
    }
    if (status === "error") {
      return t("progress.skillLoadFailed", { name: skillName });
    }
    return t("progress.loadingSkill", { name: skillName });
  };
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
      return { ...step, skillKey: step.skillKey ?? skillName, status, title: getSkillStepTitle(normalized, status) };
    });
    if (!updated) {
      steps = [...steps, {
        id: `skill-${skillName}-${timestamp}`,
        kind: "skill",
        title: getSkillStepTitle(normalized, status),
        name: normalized,
        skillKey: skillName,
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
        const toolName = String(event.data.tool_name ?? event.data.name ?? "unknown");
        if (HIDDEN_ACTIVITY_TOOLS.has(toolName)) {
          break;
        }
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
          const rawSkillId = isSkill ? String(input.name ?? "").trim() : "";

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
              ? normalizeSkillName(rawSkillId || "skill")
              : normalizedToolName;

            if (isSkill) {
              stepTitle = t("progress.loadingSkill", { name: displayName });
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

          const skillStatus: TimelineStepStatus = tc?.success === false
            ? "error"
            : tc?.success === true
              ? "complete"
              : "running";
          if (isSkill) {
            stepTitle = getSkillStepTitle(displayName, skillStatus);
          }

          const nextStep: TimelineStep = {
            id: tc ? `tool-${tc.id}` : `tool-${apiToolId}-${ord}-${event.timestamp}`,
            kind: isSkill ? "skill" : "tool",
            title: stepTitle,
            name: displayName,
            skillKey: isSkill && rawSkillId ? rawSkillId : undefined,
            rawToolName: toolName,
            status: isSkill
              ? skillStatus
              : tc?.success === false
                ? "error"
                : tc?.success === true || tc?.output !== undefined
                  ? "complete"
                  : "running",
          };

          /* skill_activated / skill_setup_failed may arrive before tool_call; those append a
           * synthetic skill row (no rawToolName). Merge this tool_call into that row so we
           * do not show two "loading skill" lines for one activation. */
          if (isSkill) {
            const syntheticIdx = steps.findLastIndex(
              (s) => s.kind === "skill" && s.name === displayName && s.rawToolName === undefined,
            );
            if (syntheticIdx !== -1) {
              const prior = steps[syntheticIdx]!;
              const mergedStatus: TimelineStepStatus =
                nextStep.status === "error" || prior.status === "error"
                  ? "error"
                  : nextStep.status === "complete" || prior.status === "complete"
                    ? "complete"
                    : nextStep.status;
              steps = steps.map((s, i) =>
                i === syntheticIdx
                  ? {
                    ...nextStep,
                    skillKey: prior.skillKey ?? nextStep.skillKey,
                    status: mergedStatus,
                    title: getSkillStepTitle(displayName, mergedStatus),
                  }
                  : s
              );
              break;
            }
          }

          steps = [...steps, nextStep];
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
        const newStatus = mapAgentStepStatus(event.data.terminal_state);
        steps = steps.map((s) =>
          s.id.startsWith(`agent-${agentId}-`)
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

  for (const toolCall of toolCalls) {
    if (!["activate_skill", "load_skill"].includes(toolCall.name)) continue;
    if (!toolCall.toolUseId.startsWith("optimistic-skill:")) continue;
    const skillName = normalizeSkillName(String(toolCall.input.name ?? ""));
    if (steps.some((step) => step.kind === "skill" && step.name === skillName)) {
      continue;
    }
    steps = [...steps, buildOptimisticSkillStep(toolCall, t)];
  }


  return steps;
}

export function isTimelineStepActionable(stepId: string): boolean {
  return stepId.startsWith("tool-") || stepId.startsWith("agent-");
}

export function buildDisplaySteps(
  steps: readonly TimelineStep[],
  taskState: TaskState,
  isWaitingForAgent: boolean,
  t: TFn,
): TimelineStep[] {
  if (steps.length > 0) return [...steps];
  const shouldShowPreparingStep = isTaskStateLive(taskState) || isWaitingForAgent;
  if (!shouldShowPreparingStep) return [];
  return [
    {
      id: "pending-start",
      kind: "start",
      title: t("progress.taskStarted"),
      status: "running",
    },
  ];
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

function stepGlyphIcon(step: TimelineStep) {
  switch (step.kind) {
    case "start":
      return Play;
    case "skill":
      return getTimelineToolOrSkillIcon("skill", step.rawToolName, step.skillKey, step.name);
    case "agent":
      return Bot;
    case "complete":
      return Flag;
    case "error":
      return AlertTriangle;
    case "tool":
      return getTimelineToolOrSkillIcon("tool", step.rawToolName, undefined, step.name);
  }
}

/* Step status theme — one map, consistent visual ratios across statuses.
   Contract:
   - Active states (error/warn/running) signal via a tinted border (~40% alpha)
     + faint matching background tint (~5%) + matching icon/text color.
   - Skipped reads as "passed over" via a dashed neutral border, no color tint.
   - Default (complete/idle) is fully neutral — chrome-light by design.
   - Hover stays in-family: tinted states deepen their own tint instead of
     flipping to the neutral `bg-accent` (avoids hue clash on warn/error rows).
   This mirrors the same border/bg/text ratio used by the new `status-*` pill
   variants in globals.css, so rows and pills speak one visual language. */
function getStepStatusVisual(status: TimelineStepStatus): StatusVisual {
  switch (status) {
    case "error":
      return {
        text: "text-destructive",
        rowBase: "surface-panel border-destructive/60 bg-card",
        rowHover: "hover:border-destructive/70 hover:bg-muted",
        iconSurface: "bg-destructive/10",
        iconColor: "text-destructive",
      };
    case "replan_required":
      return {
        text: "text-accent-amber",
        rowBase: "surface-panel border-accent-amber/60 bg-card",
        rowHover: "hover:border-accent-amber/70 hover:bg-muted",
        iconSurface: "bg-accent-amber/10",
        iconColor: "text-accent-amber",
      };
    case "skipped":
      return {
        text: "text-muted-foreground",
        rowBase: "surface-panel border-dashed bg-card",
        rowHover: "hover:border-border-strong hover:bg-muted",
        iconSurface: "bg-muted",
        iconColor: "text-muted-foreground-dim",
      };
    case "running":
      return {
        text: "text-foreground",
        rowBase: "surface-panel border-border-strong bg-card",
        rowHover: "hover:border-border-strong hover:bg-accent",
        iconSurface: "bg-muted",
        iconColor: "text-focus",
      };
    default:
      return {
        text: "text-foreground",
        rowBase: "surface-panel bg-card",
        rowHover: "hover:border-border-strong hover:bg-accent",
        iconSurface: "bg-muted",
        iconColor: "text-foreground",
      };
  }
}

/* Icon + status-colored container for each step */
function StepIcon({ step }: { readonly step: TimelineStep }) {
  const Icon = stepGlyphIcon(step);
  const visual = getStepStatusVisual(step.status);
  const useDistinctGlyph = step.kind === "tool" || step.kind === "skill";

  if (step.status === "running") {
    return (
      <span className={cn("relative", STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
        <Icon className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.25} />
        <span className="absolute inset-0 rounded-md bg-focus/20 animate-pulsing-dot-fade" />
      </span>
    );
  }

  if (step.status === "error") {
    if (useDistinctGlyph) {
      return (
        <span className={cn("relative", STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
          <Icon className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.25} />
          <CircleX
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-destructive"
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      );
    }
    return (
      <span className={cn(STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
        <CircleX className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.25} />
      </span>
    );
  }

  if (step.status === "replan_required") {
    return (
      <span className={cn(STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
        <AlertTriangle className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.25} />
      </span>
    );
  }

  if (step.status === "skipped") {
    return (
      <span className={cn(STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
        <Minus className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.25} />
      </span>
    );
  }

  if (useDistinctGlyph) {
    return (
      <span className={cn("relative", STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
        <Icon className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.25} />
        <Check
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-accent-emerald"
          strokeWidth={3}
          aria-hidden
        />
      </span>
    );
  }

  return (
    <span className={cn(STEP_ICON_FRAME_CLASS, visual.iconSurface)}>
      <Check className={cn(STEP_ICON_GLYPH_CLASS, visual.iconColor)} strokeWidth={2.5} />
    </span>
  );
}

/* State badge shown next to the title */
function TaskStateBadge({ state, t }: { readonly state: TaskState; readonly t: TFn }) {
  switch (state) {
    case "planning":
      return (
        <span className="status-pill status-warn">
          <Lightbulb className="h-3 w-3" />
          {t("progress.statePlanning")}
        </span>
      );
    case "executing":
      return (
        <span className="status-pill status-info">
          <PulsingDot size="sm" />
          {t("progress.stateExecuting")}
        </span>
      );
    case "complete":
      return (
        <span className="status-pill status-ok">
          <CircleCheck className="h-3 w-3" />
          {t("progress.stateComplete")}
        </span>
      );
    case "error":
      return (
        <span className="status-pill status-error">
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
  isWaitingForAgent = false,
  onClick,
  onStepClick,
  panelOpen = false,
}: AgentProgressCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const stepsScrollRef = useRef<HTMLDivElement>(null);
  const stepListId = useId();
  const toolIndexes = useMemo(() => buildToolCallIndexes(toolCalls), [toolCalls]);

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentStatuses) {
      if (agent.name) map.set(agent.agentId, agent.name);
    }
    return map;
  }, [agentStatuses]);

  const steps = useMemo(
    () => buildSteps(events, toolIndexes, toolCalls, t, agentNameMap),
    [events, toolIndexes, toolCalls, t, agentNameMap],
  );

  useStickyBottom(stepsScrollRef, { enabled: expanded && steps.length > 0 });

  const displaySteps = useMemo(
    () => buildDisplaySteps(steps, taskState, isWaitingForAgent, t),
    [steps, taskState, isWaitingForAgent, t],
  );
  const completedCount = displaySteps.filter((s) => s.status === "complete").length;
  const totalCount = displaySteps.length;
  const isRunning = isTaskStateLive(taskState);
  const progressPercent = useMemo(
    () => computeAgentTaskProgressPercent(taskState, completedCount, totalCount),
    [taskState, completedCount, totalCount],
  );

  const headerProgressLine = useMemo(() => {
    if (displaySteps.length === 0) return undefined;
    if (isRunning) {
      const runningStep = [...displaySteps].reverse().find((s) => s.status === "running");
      if (runningStep?.title) return runningStep.title;
    }
    return displaySteps[displaySteps.length - 1]?.title;
  }, [displaySteps, isRunning]);

  if (totalCount === 0) return null;
  const taskStateAnnouncement = getTaskStateAnnouncement(taskState, t);
  return (
    <motion.div
      lang="en"
      className="surface-panel overflow-hidden border-border shadow-card"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {headerProgressLine ? `${taskStateAnnouncement}: ${headerProgressLine}.` : `${taskStateAnnouncement}.`} {expanded ? "Expanded." : "Collapsed."} {panelOpen ? "Panel open." : "Panel closed."}
      </div>

      {/* Header */}
      <div className="border-b border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label={panelOpen ? t("progress.closePanel") : t("progress.openPanel")}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <span className="label-mono flex-1 truncate text-muted-foreground">{t("progress.title")}</span>
          <TaskStateBadge state={taskState} t={t} />
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
            {completedCount}/{totalCount}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? t("a11y.collapse") : t("a11y.expand")}
            aria-expanded={expanded}
            aria-controls={stepListId}
            onClick={() => setExpanded((prev) => !prev)}
            className="border border-transparent text-muted-foreground hover:border-border hover:bg-muted/45 hover:text-foreground"
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

        {headerProgressLine && (!expanded || isRunning) && (
          <p className="mt-1.5 break-words text-xs text-muted-foreground">
            {headerProgressLine}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-3 pb-2.5 pt-2">
        <Progress
          value={progressPercent}
          className="h-2 rounded-full bg-muted"
          indicatorClassName={getTaskStateProgressIndicatorClass(taskState)}
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
              <div
                id={stepListId}
                ref={stepsScrollRef}
                className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm"
              >
                {displaySteps.map((step) => {
                    const isClickable = isTimelineStepActionable(step.id);
                    const stepVisual = getStepStatusVisual(step.status);
                    const rowClassName = cn(
                      "flex items-start gap-2.5 rounded-xl px-3 py-2 transition-colors duration-150",
                      stepVisual.rowBase,
                      isClickable && "cursor-pointer transition-colors duration-150",
                      isClickable && stepVisual.rowHover,
                      isClickable &&
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    );
                    const rowContent = (
                      <>
                        <StepIcon step={step} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate leading-6",
                            stepVisual.text,
                          )}
                        >
                          {step.kind === "agent" ? (
                            <AgentStepTitleLine
                              step={step}
                              t={t}
                              mainClass={stepVisual.text}
                            />
                          ) : step.name ? (
                            <StepTitleLine
                              title={step.title}
                              name={step.name}
                              statusClass={stepVisual.text}
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
                        transition={{ duration: 0.12, ease: "easeOut" }}
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
                        transition={{ duration: 0.12, ease: "easeOut" }}
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
