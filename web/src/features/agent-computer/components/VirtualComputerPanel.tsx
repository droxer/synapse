"use client";

import { useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Monitor,
  CircleCheck,
  Loader2,
  Lightbulb,
  X,
  SkipBack,
  SkipForward,
  Pencil,
} from "lucide-react";
import { Slider } from "@/shared/components/ui/slider";
import { formatInput, formatToolPreview } from "../lib/format-tools";
import { AgentStatusRow } from "./AgentStatusRow";
import type { ToolCallInfo, AgentStatus, TaskState } from "@/shared/types";

/* ── tool name → friendly verb mapping ── */
const TOOL_VERBS: Record<string, string> = {
  web_search: "searching the web",
  web_fetch: "reading a webpage",
  code_execution: "running code",
  ask_user: "asking you",
  memory_read: "reading memory",
  memory_write: "saving to memory",
  spawn_agent: "spawning an agent",
};

function toolLabel(name: string): string {
  return TOOL_VERBS[name] ?? `using ${name}`;
}

/* ── icon for the activity bar ── */
function ToolIcon({ name }: { readonly name: string }) {
  if (name === "code_execution") {
    return <Monitor className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  return <Pencil className="h-3.5 w-3.5 text-muted-foreground" />;
}

interface VirtualComputerPanelProps {
  reasoningSteps: string[];
  thinkingContent: string;
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  currentIteration: number;
  taskState: TaskState;
  onClose?: () => void;
}

export function VirtualComputerPanel({
  thinkingContent,
  toolCalls,
  agentStatuses,
  taskState,
  onClose,
}: VirtualComputerPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({
      top: contentRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [toolCalls, thinkingContent]);

  const latestToolCall = toolCalls[toolCalls.length - 1];
  const isRunning = taskState === "executing" || taskState === "planning";

  const completedCount = useMemo(
    () => toolCalls.filter((t) => t.output !== undefined).length,
    [toolCalls],
  );

  const progressValue = useMemo(() => {
    if (taskState === "complete") return 100;
    if (taskState === "idle" || toolCalls.length === 0) return 0;
    return Math.min(95, (completedCount / Math.max(1, toolCalls.length)) * 100);
  }, [taskState, toolCalls.length, completedCount]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          HiAgent&apos;s Computer
        </span>
        <div className="flex items-center gap-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Activity status bar ── */}
      {isRunning && latestToolCall && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-4 py-2">
          <ToolIcon name={latestToolCall.name} />
          <span className="text-xs text-muted-foreground">
            HiAgent is {toolLabel(latestToolCall.name)}
          </span>
          {latestToolCall.output === undefined && (
            <span className="ml-auto max-w-[240px] truncate font-mono text-xs text-muted-foreground/70">
              {formatToolPreview(latestToolCall.input)}
            </span>
          )}
        </div>
      )}

      {/* ── Content area ── */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto px-5 py-4"
      >
        {/* Empty state */}
        {toolCalls.length === 0 && !thinkingContent && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Monitor className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground">
              Waiting for agent activity...
            </p>
          </div>
        )}

        {/* Thinking block */}
        {thinkingContent && (
          <div className="mb-5 rounded-lg border border-purple-200 bg-purple-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-500">
                Thinking
              </span>
              <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-purple-900/70">
              {thinkingContent}
            </p>
          </div>
        )}

        {/* Tool call entries */}
        <div className="space-y-3">
          {toolCalls.map((tc) => (
            <motion.div
              key={tc.id}
              className="rounded-lg border border-border bg-card p-3.5"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {/* Tool call header */}
              <div className="flex items-center gap-2">
                {tc.output !== undefined ? (
                  <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
                )}
                <span className="text-[13px] font-semibold text-foreground">
                  {tc.name}
                </span>
                {Object.keys(tc.input).length > 0 && (
                  <span className="truncate text-xs text-muted-foreground">
                    {formatInput(tc.input)}
                  </span>
                )}
              </div>

              {/* Output */}
              {tc.output !== undefined && (
                <div className="mt-2.5 rounded-md bg-muted/60 px-3 py-2">
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                    {tc.output.length > 500
                      ? tc.output.slice(0, 500) + "\n..."
                      : tc.output}
                  </pre>
                </div>
              )}

              {/* Running state */}
              {tc.output === undefined && (
                <p className="mt-2 text-xs text-muted-foreground animate-pulse">
                  Running...
                </p>
              )}
            </motion.div>
          ))}
        </div>

        {/* Agent statuses */}
        {agentStatuses.length > 0 && (
          <div className="mt-4 space-y-2">
            {agentStatuses.map((agent) => (
              <AgentStatusRow key={agent.agentId} agent={agent} variant="light" />
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom timeline bar ── */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2.5">
        {/* Step navigation */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Timeline slider */}
        <Slider
          value={[progressValue]}
          max={100}
          step={1}
          className="flex-1"
        />

        {/* Live / Done indicator */}
        {isRunning && (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              live
            </span>
          </div>
        )}

        {taskState === "complete" && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-medium text-muted-foreground">
              done
            </span>
          </div>
        )}
      </div>

      {/* ── Task summary footer ── */}
      {toolCalls.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-4 py-2">
          {taskState === "complete" ? (
            <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
          ) : isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          ) : null}
          <span className="flex-1 truncate text-xs text-muted-foreground">
            {taskState === "complete"
              ? "Task completed"
              : isRunning
                ? `Processing step ${completedCount + 1}...`
                : "Idle"}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {completedCount} / {toolCalls.length}
          </span>
        </div>
      )}
    </div>
  );
}
