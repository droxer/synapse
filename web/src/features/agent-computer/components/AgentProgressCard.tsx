"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { AgentEvent, TaskState, ToolCallInfo, AgentStatus } from "@/shared/types";
import { normalizeToolName } from "@/features/agent-computer/lib/tool-constants";

interface AgentProgressCardProps {
  events: AgentEvent[];
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  taskState: TaskState;
  thinkingContent: string;
  onClick?: () => void;
  panelOpen?: boolean;
}

interface TimelineStep {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "complete" | "error";
}

function buildSteps(
  events: AgentEvent[],
  toolCalls: ToolCallInfo[],
  taskState: TaskState,
  thinkingContent: string,
): TimelineStep[] {
  let steps: readonly TimelineStep[] = [];
  const seenTools = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "task_start":
        steps = [...steps, {
          id: `start-${event.timestamp}`,
          title: "Task Started",
          status: "complete",
        }];
        break;

      case "thinking":
        steps = [...steps, {
          id: `think-${event.timestamp}`,
          title: "Reasoning",
          status: "complete",
        }];
        break;

      case "tool_call": {
        const toolName = String(event.data.name ?? event.data.tool_name ?? "unknown");
        const toolId = String(event.data.tool_id ?? event.data.id ?? event.timestamp);
        if (!seenTools.has(toolId)) {
          seenTools.add(toolId);
          const tc = toolCalls.find((t) => t.id === toolId);
          steps = [...steps, {
            id: `tool-${toolId}`,
            title: `Using ${normalizeToolName(toolName)}`,
            status: tc?.output !== undefined ? "complete" : "running",
          }];
        }
        break;
      }

      case "agent_spawn":
        steps = [...steps, {
          id: `agent-${event.data.agent_id ?? event.data.id}-${event.timestamp}`,
          title: `Sub-agent: ${String(event.data.description ?? "working")}`.slice(0, 60),
          status: "running",
        }];
        break;

      case "agent_complete": {
        const agentId = String(event.data.agent_id ?? event.data.id ?? "");
        const newStatus: TimelineStep["status"] = event.data.error ? "error" : "complete";
        steps = steps.map((s) =>
          s.id.startsWith("agent-") && s.id.includes(agentId)
            ? { ...s, status: newStatus }
            : s
        );
        break;
      }

      case "task_complete":
        steps = [...steps, {
          id: `complete-${event.timestamp}`,
          title: "Task Complete",
          status: "complete",
        }];
        break;

      case "task_error":
        steps = [...steps, {
          id: `error-${event.timestamp}`,
          title: "Error",
          status: "error",
        }];
        break;
    }
  }

  if (thinkingContent && taskState === "executing") {
    const hasLive = steps.some((s) => s.title === "Reasoning" && s.status === "running");
    if (!hasLive) {
      steps = [...steps, {
        id: "thinking-live",
        title: "Reasoning...",
        status: "running",
      }];
    }
  }

  return [...steps];
}

/* Colored dot status indicators */
function StatusDot({ status }: { readonly status: TimelineStep["status"] }) {
  if (status === "complete") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-accent-emerald" />;
  }
  if (status === "error") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-accent-rose" />;
  }
  // Running — with orbital pulse
  return <PulsingDot size="md" />;
}

function statusColorClass(status: TimelineStep["status"]): string {
  if (status === "complete") return "text-accent-emerald";
  if (status === "error") return "text-accent-rose";
  return "text-ai-glow";
}

export function AgentProgressCard({
  events,
  toolCalls,
  agentStatuses,
  taskState,
  thinkingContent,
  onClick,
  panelOpen = false,
}: AgentProgressCardProps) {
  const [expanded, setExpanded] = useState(true);

  const steps = useMemo(
    () => buildSteps(events, toolCalls, taskState, thinkingContent),
    [events, toolCalls, taskState, thinkingContent],
  );

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const totalCount = steps.length;
  const isRunning = taskState === "executing";
  const progressRatio = totalCount > 0 ? completedCount / totalCount : 0;

  const subtitle = useMemo(() => {
    if (!isRunning) return "Complete";
    const runningStep = [...steps].reverse().find((s) => s.status === "running");
    return runningStep ? runningStep.title : undefined;
  }, [steps, isRunning]);

  if (totalCount === 0) return null;

  return (
    <motion.div
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ boxShadow: "var(--shadow-card-hover)", borderColor: "var(--color-border-strong)" }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
    >
      {/* Progress bar — gradient with glow */}
      <div
        className="h-0.5 w-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.round(progressRatio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Task progress: ${Math.round(progressRatio * 100)}%`}
      >
        <motion.div
          className="h-full"
          style={{
            background: "linear-gradient(90deg, var(--color-ai-glow), var(--color-accent-purple))",
            boxShadow: "0 0 8px color-mix(in srgb, var(--color-ai-glow) 30%, transparent)",
          }}
          initial={{ width: 0 }}
          animate={{ width: `${progressRatio * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
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
                HiAgent&apos;s Computer
              </span>
              {isRunning && <PulsingDot size="sm" />}
            </div>
            {subtitle && (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  "text-xs truncate",
                  isRunning ? "text-muted-foreground" : "text-accent-emerald",
                )}
              >
                {subtitle}
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
          aria-label={panelOpen ? "Close computer panel" : "Open computer panel"}
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
              <div className="max-h-48 overflow-y-auto font-mono text-xs">
                <div className="space-y-0.5">
                  {steps.map((step, index) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: index * 0.03,
                        duration: 0.2,
                        ease: "easeOut",
                      }}
                      className="flex items-center gap-2.5 py-0.5"
                    >
                      <StatusDot status={step.status} />
                      <span
                        className={cn(
                          "truncate",
                          step.status === "running" && "text-foreground",
                          step.status === "complete" && "text-muted-foreground",
                          step.status === "error" && "text-accent-rose",
                        )}
                      >
                        {step.title}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
