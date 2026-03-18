"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleCheck, GitFork, CircleX, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { normalizeToolName } from "../lib/tool-constants";
import { formatInput } from "../lib/format-tools";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { useTranslation } from "@/i18n";
import type { AgentStatus, ToolCallInfo } from "@/shared/types";

function ToolStatusIcon({ tc }: { readonly tc: ToolCallInfo }) {
  if (tc.output !== undefined) {
    return tc.success === false
      ? <CircleX className="h-3 w-3 shrink-0 text-accent-rose" />
      : <CircleCheck className="h-3 w-3 shrink-0 text-accent-emerald" />;
  }
  return <Loader2 className="h-3 w-3 shrink-0 text-ai-glow animate-spin" />;
}

interface AgentStatusRowProps {
  readonly agent: AgentStatus;
  readonly variant?: "light" | "dark";
  readonly toolCalls?: ToolCallInfo[];
  readonly conversationId?: string | null;
}

export function AgentStatusRow({
  agent,
  variant = "light",
  toolCalls,
  conversationId,
}: AgentStatusRowProps) {
  const { t } = useTranslation();
  const isDark = variant === "dark";
  const hasTools = toolCalls && toolCalls.length > 0;
  const [expanded, setExpanded] = useState(agent.status === "running");

  return (
    <div>
      <button
        type="button"
        onClick={() => hasTools && setExpanded((prev) => !prev)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-left transition-colors",
          isDark ? "bg-white/5" : "bg-secondary",
          hasTools && "cursor-pointer hover:bg-secondary/80",
          !hasTools && "cursor-default",
        )}
      >
        {agent.status === "complete" ? (
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" />
        ) : agent.status === "error" ? (
          <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" />
        ) : (
          <motion.span
            className="h-2 w-2 shrink-0 rounded-full bg-ai-glow"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <GitFork className={cn("h-3 w-3 shrink-0", isDark ? "text-terminal-dim" : "text-muted-foreground-dim")} />
        <span className={cn("flex-1 truncate", isDark ? "text-[var(--color-terminal-text)]" : "text-foreground")}>
          {agent.description}
        </span>
        {hasTools && (
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {toolCalls.filter((tc) => tc.output !== undefined).length}/{toolCalls.length}
          </span>
        )}
        {hasTools && (
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="flex items-center"
          >
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </motion.span>
        )}
        <span className={cn("ml-auto font-mono text-micro", isDark ? "text-[var(--color-terminal-dim)]" : "text-muted-foreground")}>
          {agent.agentId.slice(0, 8)}
        </span>
      </button>

      {/* Nested tool calls */}
      <AnimatePresence>
        {expanded && hasTools && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="ml-5 border-l border-border pl-3 py-1 space-y-1 font-mono text-sm">
              {toolCalls.map((tc) => (
                <div key={tc.id}>
                  <div className="flex items-start gap-2 py-1">
                    <ToolStatusIcon tc={tc} />
                    <span className="text-foreground text-xs">
                      {normalizeToolName(tc.name)}
                    </span>
                    {Object.keys(tc.input).length > 0 && (
                      <span className="text-muted-foreground-dim text-xs truncate max-w-[200px]">
                        — {formatInput(tc.input)}
                      </span>
                    )}
                    {tc.output === undefined && (
                      <span className="text-ai-glow animate-pulse text-xs">
                        {t("computer.running")}
                      </span>
                    )}
                  </div>
                  {tc.output !== undefined && (
                    <div className="ml-5 mb-1">
                      <ToolOutputRenderer
                        output={tc.output}
                        toolName={tc.name}
                        contentType={tc.contentType}
                        conversationId={conversationId ?? null}
                        artifactIds={tc.artifactIds}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
