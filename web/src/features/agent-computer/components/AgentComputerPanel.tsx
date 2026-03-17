"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Monitor,
  CircleCheck,
  CircleX,
  X,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { formatInput, formatToolPreview } from "../lib/format-tools";
import { HIDDEN_ACTIVITY_TOOLS, normalizeToolName } from "../lib/tool-constants";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { AgentStatusRow } from "./AgentStatusRow";
import { ArtifactFilesPanel } from "./ArtifactFilesPanel";
import { cn } from "@/shared/lib/utils";
import { PulsingDot } from "@/shared/components/PulsingDot";
import type { ToolCallInfo, AgentStatus, TaskState, ArtifactInfo } from "@/shared/types";

/* ── tool name → friendly verb mapping for status bar ── */
const TOOL_VERBS: Record<string, string> = {
  web_search: "searching the web",
  web_fetch: "reading a webpage",
  code_run: "running code",
  code_interpret: "running code",
  shell_exec: "running a command",
  user_ask: "asking you",
  memory_store: "saving to memory",
  memory_search: "searching memory",
  memory_list: "listing memories",
  image_generate: "generating an image",
  agent_spawn: "spawning an agent",
  agent_wait: "waiting for agents",
  file_read: "reading a file",
  file_write: "writing a file",
  file_edit: "editing a file",
  browser_navigate: "browsing the web",
  browser_click: "clicking an element",
  browser_type: "typing in browser",
  browser_scroll: "scrolling page",
  browser_extract: "extracting content",
  document_create_pdf: "creating a PDF",
  document_create_docx: "creating a document",
  document_create_xlsx: "creating a spreadsheet",
  document_create_pptx: "creating a presentation",
  document_read: "reading a document",
  database_query: "querying database",
  database_create: "creating database",
  database_schema: "inspecting schema",
  preview_start: "starting preview",
  preview_stop: "stopping preview",
  computer_screenshot: "taking a screenshot",
  computer_action: "performing action",
  package_install: "installing packages",
};

function toolLabel(name: string): string {
  return TOOL_VERBS[name] ?? `using ${normalizeToolName(name).toLowerCase()}`;
}

/* ── status symbol for terminal-style logs ── */
function statusSymbol(tc: ToolCallInfo): string {
  if (tc.output !== undefined) {
    return tc.success === false ? "✗" : "✓";
  }
  return "⟳";
}

function statusColor(tc: ToolCallInfo): string {
  if (tc.output !== undefined) {
    return tc.success === false ? "text-accent-rose" : "text-accent-emerald";
  }
  return "text-ai-glow";
}

type PanelTab = "activity" | "files";

interface AgentComputerPanelProps {
  conversationId: string | null;
  toolCalls: ToolCallInfo[];
  agentStatuses: AgentStatus[];
  artifacts: ArtifactInfo[];
  taskState: TaskState;
  onClose?: () => void;
}

export function AgentComputerPanel({
  conversationId,
  toolCalls,
  agentStatuses,
  artifacts,
  taskState,
  onClose,
}: AgentComputerPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("activity");

  const visibleToolCalls = useMemo(
    () => toolCalls.filter((t) => !HIDDEN_ACTIVITY_TOOLS.has(t.name)),
    [toolCalls],
  );

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
          <span className="text-sm font-semibold tracking-tight text-foreground">
            HiAgent&apos;s Computer
          </span>
          <div className="flex items-center gap-1">
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close panel"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex gap-1 px-4 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "activity"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Monitor className="h-3 w-3" />
            Activity
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("files")}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "files"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderOpen className="h-3 w-3" />
            Artifacts
            {artifacts.length > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] font-semibold">
                {artifacts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Files tab ── */}
      {activeTab === "files" && (
        <div className="flex-1 overflow-y-auto">
          <ArtifactFilesPanel artifacts={artifacts} conversationId={conversationId} />
        </div>
      )}

      {/* ── Activity tab ── */}
      {/* ── Activity status bar ── */}
      {activeTab === "activity" && isRunning && latestToolCall && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2" role="status" aria-live="polite">
          <PulsingDot size="sm" />
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

      {/* ── Activity content area — terminal-style logs ── */}
      {activeTab === "activity" && (
        <>
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto px-6 py-4"
          >
            {/* Empty state */}
            {visibleToolCalls.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                  <Monitor className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Waiting for agent activity...
                </p>
              </div>
            )}

            {/* Terminal-style tool call entries */}
            <div className="space-y-1 font-mono text-xs">
              {visibleToolCalls.map((tc) => (
                <motion.div
                  key={tc.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                >
                  {/* Log line */}
                  <div className="flex items-start gap-2 py-1">
                    <span className={cn("shrink-0", statusColor(tc))}>
                      [{statusSymbol(tc)}]
                    </span>
                    <span className="text-foreground/90">
                      {normalizeToolName(tc.name)}
                    </span>
                    {Object.keys(tc.input).length > 0 && (
                      <span className="text-muted-foreground/60">
                        — {formatInput(tc.input)}
                      </span>
                    )}
                    {tc.output === undefined && (
                      <motion.span
                        className="text-ai-glow"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      >
                        running...
                      </motion.span>
                    )}
                  </div>

                  {/* Output (collapsible) */}
                  {tc.output !== undefined && (
                    <div className="ml-6 mb-2">
                      <ToolOutputRenderer
                        output={tc.output}
                        toolName={tc.name}
                        contentType={tc.contentType}
                        conversationId={conversationId}
                        artifactIds={tc.artifactIds}
                      />
                    </div>
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

          {/* ── Bottom progress bar ── */}
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2.5">
            <Progress value={progressValue} className="flex-1 h-1.5" />

            {/* Live / Done indicator */}
            {isRunning && (
              <div className="flex items-center gap-1.5">
                <PulsingDot size="md" />
                <span className="text-xs font-medium text-muted-foreground">
                  live
                </span>
              </div>
            )}

            {taskState === "complete" && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent-emerald opacity-40" />
                <span className="text-xs font-medium text-muted-foreground">
                  done
                </span>
              </div>
            )}
          </div>

          {/* ── Task summary footer ── */}
          {visibleToolCalls.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-secondary/40 px-4 py-2">
              {taskState === "complete" ? (
                <CircleCheck className="h-3.5 w-3.5 text-accent-emerald" />
              ) : taskState === "error" ? (
                <CircleX className="h-3.5 w-3.5 text-accent-rose" />
              ) : isRunning ? (
                <PulsingDot size="md" />
              ) : null}
              <span className="flex-1 truncate text-xs text-muted-foreground">
                {taskState === "complete"
                  ? "Task completed"
                  : isRunning
                    ? `Processing step ${completedCount + 1}...`
                    : "Idle"}
              </span>
              <span className="text-xs font-mono font-medium text-muted-foreground">
                {completedCount} / {visibleToolCalls.length}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
