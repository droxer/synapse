"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CircleCheck,
  CircleX,
  Loader2,
  ChevronUp,
  ChevronDown,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import type { AgentEvent, TaskState, ToolCallInfo, AgentStatus } from "@/shared/types";

interface VirtualComputerCardProps {
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
            title: `Using ${toolName}`,
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

export function VirtualComputerCard({
  events,
  toolCalls,
  agentStatuses,
  taskState,
  thinkingContent,
  onClick,
  panelOpen = false,
}: VirtualComputerCardProps) {
  const [expanded, setExpanded] = useState(true);

  const steps = useMemo(
    () => buildSteps(events, toolCalls, taskState, thinkingContent),
    [events, toolCalls, taskState, thinkingContent],
  );

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const totalCount = steps.length;

  if (totalCount === 0) return null;

  const latestRunningStep = [...steps].reverse().find((s) => s.status === "running");
  const latestRunningTool = latestRunningStep?.title.startsWith("Using ")
    ? latestRunningStep.title.slice(6)
    : null;

  return (
    <motion.div
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
    >
      {/* Header — clickable to toggle right panel */}
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">HiAgent&apos;s Computer</div>
          {latestRunningTool ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span className="truncate">HiAgent is using {latestRunningTool}</span>
            </div>
          ) : latestRunningStep ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span className="truncate">{latestRunningStep.title}</span>
            </div>
          ) : taskState === "complete" ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600">
              <CircleCheck className="h-3.5 w-3.5 shrink-0" />
              <span>Complete</span>
            </div>
          ) : null}
        </div>
        {panelOpen ? (
          <PanelRightClose className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <PanelRightOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Collapse toggle + count */}
      <div className="flex items-center justify-end px-4 py-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          className="shrink-0"
        >
          <span className="font-medium">{completedCount}/{totalCount}</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Collapsible: Task progress steps */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2">Task progress</div>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                      step.status === "running" && "bg-muted"
                    )}
                  >
                    {step.status === "complete" ? (
                      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : step.status === "error" ? (
                      <CircleX className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" />
                    )}
                    <span className="truncate text-foreground">{step.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
