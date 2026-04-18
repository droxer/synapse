"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, CircleCheck, GitFork, CircleX, ChevronRight, ArrowRightLeft, AlertTriangle, Minus } from "lucide-react";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { cn } from "@/shared/lib/utils";
import { normalizeToolName, normalizeAgentName } from "../lib/tool-constants";
import { ToolOutputRenderer } from "./ToolOutputRenderer";
import { ToolArgsDisplay } from "./ToolArgsDisplay";
import { SkillActivityEntry } from "./SkillActivityEntry";
import { useTranslation } from "@/i18n";
import {
  EVENT_LEFT_RAIL_CLASSES,
  EVENT_META_BADGE_CLASSES,
  EVENT_ROW_BASE_CLASSES,
  SKILL_TOOL_NAMES,
  getToolCallTone,
  getToolCallVisualClasses,
} from "../lib/format-tools";
import { getSkillIcon, getToolIcon } from "../lib/tool-visual-icons";
import type { AgentStatus, ToolCallInfo } from "@/shared/types";

function ToolStatusIcon({ tc, label }: { readonly tc: ToolCallInfo; readonly label: string }) {
  const isSkill = SKILL_TOOL_NAMES.has(tc.name);
  const skillId = isSkill ? String(tc.input.name ?? "").trim() : "";
  const ToolGlyph = skillId ? getSkillIcon(skillId) : getToolIcon(tc.name);
  if (tc.success !== undefined) {
    return tc.success === false
      ? (
        <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted" role="img" aria-label={label}>
          <ToolGlyph className="h-3.5 w-3.5 text-destructive" strokeWidth={2.25} />
          <CircleX
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-destructive"
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      )
      : (
        <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted" role="img" aria-label={label}>
          <ToolGlyph className="h-3.5 w-3.5 text-foreground" strokeWidth={2.25} />
          <Check
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-accent-emerald"
            strokeWidth={3}
            aria-hidden
          />
        </span>
      );
  }
  return (
    <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary" role="img" aria-label={label}>
      <ToolGlyph className="h-3.5 w-3.5 text-focus" strokeWidth={2.25} />
      <span className="absolute inset-0 rounded-md bg-focus/20 animate-pulsing-dot-fade" />
    </span>
  );
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
  variant: _variant = "light",
  toolCalls,
  conversationId,
  agentNameMap,
}: AgentStatusRowProps) {
  const { t } = useTranslation();
  const hasTools = toolCalls && toolCalls.length > 0;
  const [expanded, setExpanded] = useState(agent.status === "running");

  const rowClassName = cn(
    EVENT_ROW_BASE_CLASSES,
    "flex w-full items-center gap-2 text-left text-sm transition-colors",
    hasTools && "cursor-pointer transition-colors duration-150 hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  );

  const rowContent = (
    <>
        {agent.status === "complete" ? (
          <CircleCheck className="h-4 w-4 shrink-0 text-accent-emerald" />
        ) : agent.status === "skipped" ? (
          <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : agent.status === "replan_required" ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-accent-amber" />
        ) : agent.status === "error" ? (
          <CircleX className="h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <PulsingDot size="sm" />
        )}
        <GitFork className="h-4 w-4 shrink-0 text-muted-foreground-dim" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {agent.description.includes(" → ") ? (
              <>
                {normalizeAgentName(agent.name || agent.description.split(" → ")[0])}
                <ArrowRightLeft className="mx-1 inline h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {agent.description.split(" → ").slice(1).join(" → ")}
              </>
            ) : (
              normalizeAgentName(agent.name || agent.description)
            )}
          </span>
          <span className="mt-0.5 block font-mono text-micro text-muted-foreground-dim">
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
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </motion.span>
        )}
    </>
  );

  return (
    <div>
      {hasTools ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? t("a11y.collapse") : t("a11y.expand")}
          aria-expanded={expanded}
          className={rowClassName}
        >
          {rowContent}
        </button>
      ) : (
        <div className={rowClassName}>
          {rowContent}
        </div>
      )}

      {/* Nested tool calls */}
      <AnimatePresence initial={false}>
        {expanded && hasTools && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className={cn("ml-1.5 mt-1.5 space-y-2", EVENT_LEFT_RAIL_CLASSES)}>
              {toolCalls.map((tc) => {
                if (SKILL_TOOL_NAMES.has(tc.name)) {
                  return <SkillActivityEntry key={tc.id} toolCall={tc} />;
                }
                const visual = getToolCallVisualClasses(getToolCallTone(tc));
                return (
                  <div
                    key={tc.id}
                    className={cn("rounded-xl px-3 py-2 transition-colors duration-150", visual.row, visual.rowHover)}
                  >
                    <div className="flex items-start gap-2.5 text-sm">
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
                      <span
                        className={cn(
                          "min-w-0 flex-1 leading-6",
                          tc.success === false ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {normalizeToolName(tc.name)}
                      </span>
                      {tc.success === undefined && (
                        <span className="status-pill status-info shrink-0">
                          {t("computer.running")}
                        </span>
                      )}
                    </div>
                    {Object.keys(tc.input).length > 0 && (
                      <div className="mb-0.5 mt-1">
                        <ToolArgsDisplay input={tc.input} compact />
                      </div>
                    )}
                    {tc.output !== undefined && (
                      <div className="mb-1 mt-1">
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
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
