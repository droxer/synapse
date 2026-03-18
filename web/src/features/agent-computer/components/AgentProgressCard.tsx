"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  PanelRightOpen,
  PanelRightClose,
  CircleCheck,
  CircleX,
  Lightbulb,
  Loader2,
  Play,
  Brain,
  Code,
  FileText,
  Globe,
  Database,
  Eye,
  Sparkles,
  Bot,
  Flag,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { AgentEvent, TaskState, ToolCallInfo, AgentStatus } from "@/shared/types";
import { normalizeToolName, getToolCategory } from "@/features/agent-computer/lib/tool-constants";
import type { ToolCategory } from "@/features/agent-computer/lib/tool-constants";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";

interface AgentProgressCardProps {
  events: AgentEvent[];
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  taskState: TaskState;
  thinkingContent: string;
  onClick?: () => void;
  onStepClick?: (stepId: string) => void;
  panelOpen?: boolean;
}

type StepKind = "start" | "thinking" | "tool" | "skill" | "agent" | "complete" | "error";

interface TimelineStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly title: string;
  /** The tool, skill, or agent name — rendered with emphasis when present */
  readonly name?: string;
  /** Raw tool name for category-based icon lookup */
  readonly rawToolName?: string;
  readonly status: "running" | "complete" | "error";
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

function buildSteps(
  events: AgentEvent[],
  toolCalls: ToolCallInfo[],
  taskState: TaskState,
  thinkingContent: string,
  t: TFn,
): TimelineStep[] {
  let steps: readonly TimelineStep[] = [];
  const seenTools = new Set<string>();

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

      case "thinking":
        steps = [...steps, {
          id: `think-${event.timestamp}`,
          kind: "thinking",
          title: t("progress.reasoning"),
          status: "complete",
        }];
        break;

      case "tool_call": {
        const toolName = String(event.data.name ?? event.data.tool_name ?? "unknown");
        const toolId = String(event.data.tool_id ?? event.data.id ?? event.timestamp);
        if (!seenTools.has(toolId)) {
          seenTools.add(toolId);
          const tc = toolCalls.find((t) => t.id === toolId);
          const isSkill = toolName === "activate_skill" || toolName === "load_skill";
          const input = (event.data.input ?? event.data.tool_input ?? event.data.arguments ?? {}) as Record<string, unknown>;
          const displayName = isSkill
            ? normalizeSkillName(String(input.name ?? "skill"))
            : normalizeToolName(toolName);
          const stepTitle = isSkill
            ? t("progress.loadingSkill", { name: displayName })
            : t("progress.usingTool", { name: displayName });
          steps = [...steps, {
            id: `tool-${toolId}`,
            kind: isSkill ? "skill" : "tool",
            title: stepTitle,
            name: displayName,
            rawToolName: toolName,
            status: tc?.output !== undefined ? "complete" : "running",
          }];
        }
        break;
      }

      case "agent_spawn": {
        const spawnAgentId = String(event.data.agent_id ?? event.data.id ?? "");
        const agentToolCount = toolCalls.filter((tc) => tc.agentId === spawnAgentId).length;
        const toolSuffix = agentToolCount > 0 ? ` (${agentToolCount} tools)` : "";
        steps = [...steps, {
          id: `agent-${spawnAgentId}-${event.timestamp}`,
          kind: "agent",
          title: t("progress.subAgent", { description: String(event.data.description ?? "working") }).slice(0, 55) + toolSuffix,
          status: "running",
        }];
        break;
      }

      case "agent_complete": {
        const agentId = String(event.data.agent_id ?? event.data.id ?? "");
        const completedToolCount = toolCalls.filter((tc) => tc.agentId === agentId).length;
        const completeSuffix = completedToolCount > 0 ? ` (${completedToolCount} tools)` : "";
        const newStatus: TimelineStep["status"] = event.data.error ? "error" : "complete";
        steps = steps.map((s) =>
          s.id.startsWith("agent-") && s.id.includes(agentId)
            ? { ...s, status: newStatus, title: s.title.replace(/ \(\d+ tools\)$/, "") + completeSuffix }
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

  if (thinkingContent && taskState === "executing") {
    const hasLive = steps.some((s) => s.title === t("progress.reasoning") && s.status === "running");
    if (!hasLive) {
      steps = [...steps, {
        id: "thinking-live",
        kind: "thinking",
        title: t("progress.reasoningLive"),
        status: "running",
      }];
    }
  }

  return [...steps];
}

/* Category-based icon for each tool kind */
function toolCategoryIcon(category: ToolCategory) {
  switch (category) {
    case "code": return Code;
    case "file": return FileText;
    case "search": return Globe;
    case "memory": return Database;
    case "browser": return Eye;
    case "preview": return Eye;
    default: return Wrench;
  }
}

function kindIcon(kind: StepKind, rawToolName?: string) {
  switch (kind) {
    case "start": return Play;
    case "thinking": return Brain;
    case "skill": return Sparkles;
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
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ai-glow/15">
        <Icon className="h-3 w-3 text-ai-glow" />
        <span className="absolute inset-0 rounded bg-ai-glow/10 animate-pulse" />
      </span>
    );
  }

  if (step.status === "error") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-rose/15">
        <CircleX className="h-3 w-3 text-accent-rose" />
      </span>
    );
  }

  // complete — swap category icon for a check
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-emerald/10">
      <Check className="h-3 w-3 text-accent-emerald" />
    </span>
  );
}

/* State badge shown next to the title */
function TaskStateBadge({ state, t }: { readonly state: TaskState; readonly t: TFn }) {
  switch (state) {
    case "planning":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-amber/10 px-2 py-0.5 text-xs font-medium text-accent-amber">
          <Lightbulb className="h-3 w-3" />
          {t("progress.statePlanning")}
        </span>
      );
    case "executing":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-ai-glow/10 px-2 py-0.5 text-xs font-medium text-ai-glow">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("progress.stateExecuting")}
        </span>
      );
    case "complete":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-emerald/10 px-2 py-0.5 text-xs font-medium text-accent-emerald">
          <CircleCheck className="h-3 w-3" />
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
  thinkingContent,
  onClick,
  onStepClick,
  panelOpen = false,
}: AgentProgressCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const steps = useMemo(
    () => buildSteps(events, toolCalls, taskState, thinkingContent, t),
    [events, toolCalls, taskState, thinkingContent, t],
  );

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const totalCount = steps.length;
  const isRunning = taskState === "executing";
  const progressRatio = totalCount > 0 ? completedCount / totalCount : 0;

  const runningStepTitle = useMemo(() => {
    if (!isRunning) return undefined;
    const runningStep = [...steps].reverse().find((s) => s.status === "running");
    return runningStep?.title;
  }, [steps, isRunning]);

  if (totalCount === 0) return null;

  return (
    <motion.div
      className="overflow-hidden rounded-lg border border-border bg-card hover:border-border-strong transition-colors"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* Progress bar — solid accent */}
      <div
        className="h-0.5 w-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.round(progressRatio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progress.taskProgress", { percent: Math.round(progressRatio * 100) })}
      >
        <motion.div
          className={cn(
            "h-full",
            taskState === "complete" && "bg-accent-emerald",
            taskState === "error" && "bg-accent-rose",
            taskState === "planning" && "bg-accent-amber",
            (taskState === "executing" || taskState === "idle") && "bg-accent-purple",
          )}
          initial={{ width: 0 }}
          animate={{ width: `${progressRatio * 100}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>

      {/* Unified header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Left: clickable title area — toggles expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="group flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {t("progress.title")}
              </span>
              <TaskStateBadge state={taskState} t={t} />
            </div>
            {runningStepTitle && (
              <div
                role="status"
                aria-live="polite"
                className="text-sm truncate text-muted-foreground"
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
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
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
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              <div className="max-h-60 overflow-y-auto font-mono text-sm">
                <div className="space-y-1.5">
                  {steps.map((step, index) => {
                    const isClickable = step.id.startsWith("tool-") || step.id.startsWith("agent-");
                    return (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          delay: index * 0.03,
                          duration: 0.2,
                          ease: "easeOut",
                        }}
                        className={cn(
                          "flex items-center gap-2.5 py-1.5 rounded-md px-1.5 -mx-1.5",
                          isClickable && "cursor-pointer hover:bg-secondary/60 transition-colors",
                        )}
                        onClick={isClickable ? () => onStepClick?.(step.id) : undefined}
                        role={isClickable ? "button" : undefined}
                        tabIndex={isClickable ? 0 : undefined}
                        onKeyDown={isClickable ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onStepClick?.(step.id);
                          }
                        } : undefined}
                      >
                        <StepIcon step={step} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            step.status === "running" && "text-foreground",
                            step.status === "complete" && "text-muted-foreground",
                            step.status === "error" && "text-accent-rose",
                          )}
                        >
                          {step.name ? (
                            <>
                              {step.title.split(step.name)[0]}
                              <span
                                className={cn(
                                  "font-semibold",
                                  step.status === "running" && "text-ai-glow",
                                  step.status === "complete" && "text-foreground",
                                  step.status === "error" && "text-accent-rose",
                                )}
                              >
                                {step.name}
                              </span>
                              {step.title.split(step.name).slice(1).join(step.name)}
                            </>
                          ) : (
                            step.title
                          )}
                        </span>
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
