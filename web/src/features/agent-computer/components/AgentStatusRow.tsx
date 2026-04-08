"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleCheck, GitFork, CircleX, ChevronRight, ArrowRightLeft } from "lucide-react";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { cn } from "@/shared/lib/utils";
import { normalizeToolName, normalizeAgentName } from "../lib/tool-constants";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import { useTranslation } from "@/i18n";
import type { AgentStatus, ToolCallInfo } from "@/shared/types";

function ToolStatusIcon({ tc }: { readonly tc: ToolCallInfo }) {
  if (tc.output !== undefined) {
    return tc.success === false
      ? <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" />
      : <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" />;
  }
  return <PulsingDot size="sm" />;
}

interface AgentStatusRowProps {
  readonly agent: AgentStatus;
  readonly variant?: "light" | "dark";
  readonly toolCalls?: ToolCallInfo[];
  readonly conversationId?: string | null;
  readonly agentNameMap?: ReadonlyMap<string, string>;
}

export function AgentStatusRow({
  agent,
  variant = "light",
  toolCalls,
  conversationId,
  agentNameMap,
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
        aria-label={hasTools ? (expanded ? t("a11y.collapse") : t("a11y.expand")) : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "bg-secondary/70",
          hasTools && "cursor-pointer hover:bg-muted/70",
          !hasTools && "cursor-default",
        )}
      >
        {agent.status === "complete" ? (
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" />
        ) : agent.status === "error" ? (
          <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" />
        ) : (
          <PulsingDot size="sm" />
        )}
        <GitFork className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-terminal-dim" : "text-muted-foreground-dim")} />
        <span className={cn("flex-1 truncate", isDark ? "text-[var(--color-terminal-text)]" : "text-foreground")}>
          {agent.description.includes(" → ") ? (
            <>
              {normalizeAgentName(agent.name || agent.description.split(" → ")[0])}
              <ArrowRightLeft className="mx-1 inline h-3.5 w-3.5 text-muted-foreground" />
              {agent.description.split(" → ").slice(1).join(" → ")}
            </>
          ) : (
            normalizeAgentName(agent.name || agent.description)
          )}
        </span>
        {hasTools && (
          <span className="text-micro font-mono text-muted-foreground tabular-nums">
            {toolCalls.filter((tc) => tc.output !== undefined).length}/{toolCalls.length}
          </span>
        )}
        {hasTools && (
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex items-center"
          >
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.span>
        )}
        <span className={cn("ml-auto font-mono text-micro", isDark ? "text-[var(--color-terminal-dim)]" : "text-muted-foreground-dim")}>
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
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="ml-4 mt-1 space-y-1 rounded-md border-l border-border/80 pl-3">
              {toolCalls.map((tc) => (
                <div key={tc.id}>
                  <div className="flex items-start gap-2.5 py-1">
                    <ToolStatusIcon tc={tc} />
                    <span className="text-sm text-foreground">
                      {normalizeToolName(tc.name)}
                    </span>
                    {tc.output === undefined && (
                      <span className="text-sm text-muted-foreground">
                        {t("computer.running")}
                      </span>
                    )}
                  </div>
                  {Object.keys(tc.input).length > 0 && (
                    <div className="ml-4 mb-0.5">
                      <ToolArgsDisplay input={tc.input} compact />
                    </div>
                  )}
                  {tc.output !== undefined && (
                    <div className="ml-4 mb-1">
                      <ToolOutputRenderer
                        output={tc.output}
                        toolName={tc.name}
                        success={tc.success}
                        contentType={tc.contentType}
                        conversationId={conversationId ?? null}
                        artifactIds={tc.artifactIds}
                        browserMetadata={tc.browserMetadata}
                        computerUseMetadata={tc.computerUseMetadata}
                        agentNameMap={agentNameMap}
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
