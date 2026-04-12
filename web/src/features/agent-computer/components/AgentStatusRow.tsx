"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleCheck, GitFork, CircleX, ChevronRight, ArrowRightLeft, AlertTriangle, Minus } from "lucide-react";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { cn } from "@/shared/lib/utils";
import { normalizeToolName, normalizeAgentName } from "../lib/tool-constants";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import { useTranslation } from "@/i18n";
import { EVENT_LEFT_RAIL_CLASSES, EVENT_META_BADGE_CLASSES, EVENT_ROW_BASE_CLASSES } from "../lib/format-tools";
import type { AgentStatus, ToolCallInfo } from "@/shared/types";

function ToolStatusIcon({ tc, label }: { readonly tc: ToolCallInfo; readonly label: string }) {
  if (tc.success !== undefined) {
    return tc.success === false
      ? <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" role="img" aria-label={label} />
      : <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" role="img" aria-label={label} />;
  }
  return <PulsingDot size="sm" aria-label={label} />;
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
          EVENT_ROW_BASE_CLASSES,
          "flex w-full items-center gap-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          hasTools && "cursor-pointer hover:bg-muted/20",
          !hasTools && "cursor-default",
        )}
      >
        {agent.status === "complete" ? (
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-accent-emerald" />
        ) : agent.status === "skipped" ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : agent.status === "replan_required" ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-accent-amber" />
        ) : agent.status === "error" ? (
          <CircleX className="h-3.5 w-3.5 shrink-0 text-accent-rose" />
        ) : (
          <PulsingDot size="sm" />
        )}
        <GitFork className={cn("h-3.5 w-3.5 shrink-0", isDark ? "text-terminal-dim" : "text-muted-foreground-dim")} />
        <div className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", isDark ? "text-[var(--color-terminal-text)]" : "text-foreground")}>
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
          <span className={cn("mt-0.5 block font-mono text-micro", isDark ? "text-[var(--color-terminal-dim)]" : "text-muted-foreground-dim")}>
            {agent.agentId.slice(0, 8)}
          </span>
        </div>
        {hasTools && (
          <span className={cn(EVENT_META_BADGE_CLASSES, "font-mono tabular-nums text-muted-foreground-dim")}>
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
            <div className={cn("ml-1.5 mt-1.5 space-y-2", EVENT_LEFT_RAIL_CLASSES)}>
              {toolCalls.map((tc) => (
                <div key={tc.id} className="rounded-sm px-0.5 py-1">
                  <div className="flex items-start gap-2.5">
                    <ToolStatusIcon
                      tc={tc}
                      label={
                        tc.success !== undefined
                          ? tc.success === false
                            ? t("a11y.toolFailed")
                            : t("a11y.toolSuccess")
                          : t("a11y.toolRunning")
                      }
                    />
                    <span className="text-sm text-foreground">
                      {normalizeToolName(tc.name)}
                    </span>
                    {tc.success === undefined && (
                      <span className="text-sm text-muted-foreground">
                        {t("computer.running")}
                      </span>
                    )}
                  </div>
                  {Object.keys(tc.input).length > 0 && (
                    <div className="mt-1 mb-0.5 pl-2">
                      <ToolArgsDisplay input={tc.input} compact />
                    </div>
                  )}
                  {tc.output !== undefined && (
                    <div className="mt-1 mb-1 pl-2">
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
