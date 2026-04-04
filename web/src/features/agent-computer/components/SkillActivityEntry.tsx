"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, ChevronRight, Check } from "lucide-react";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { cn } from "@/shared/lib/utils";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import { SOURCE_STYLE, SOURCE_LABEL_KEY } from "@/features/skills/lib/skill-source-styles";
import { useSkillsCache } from "@/features/skills/hooks/use-skills-cache";
import { Badge } from "@/shared/components/ui/badge";
import { useTranslation } from "@/i18n";
import { Skeleton } from "@/shared/components/ui/skeleton";
import type { ToolCallInfo } from "@/shared/types";

/* ── helpers ── */

/** Count non-empty lines in output. */
function countLines(output?: string): number {
  if (!output) return 0;
  return output.split("\n").filter((l) => l.trim().length > 0).length;
}

/** Count resource files mentioned in the output. */
function countResources(output?: string): number {
  if (!output) return 0;
  const matches = output.match(/<file>/g);
  return matches?.length ?? 0;
}

/** Expandable error message for skill failures (L5). */
function ErrorMessage({ output, t }: { readonly output: string; readonly t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = output.length > 200;

  return (
    <div className="mt-1.5">
      <p className={cn("text-sm leading-relaxed text-accent-rose", !expanded && "line-clamp-2")}>
        {expanded ? output : output.slice(0, 200)}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="mt-0.5 text-micro font-medium text-accent-rose transition-colors hover:text-accent-rose"
          aria-label={expanded ? t("skills.activity.hideError") : t("skills.activity.showError")}
        >
          {expanded ? t("skills.activity.hideError") : t("skills.activity.showError")}
        </button>
      )}
    </div>
  );
}

/* ── component ── */

interface SkillActivityEntryProps {
  readonly toolCall: ToolCallInfo;
}

export function SkillActivityEntry({ toolCall }: SkillActivityEntryProps) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const toggleRaw = useCallback(() => setShowRaw((p) => !p), []);

  const { getSkill, isLoading } = useSkillsCache();

  const skillName = String(toolCall.input.name ?? "unknown");
  const displayName = normalizeSkillName(skillName);
  const isComplete = toolCall.output !== undefined;
  const isError = isComplete && toolCall.success === false;

  const skillMeta = getSkill(skillName);
  // Show skeletons only while cache is still loading; once loaded/failed, hide them
  const showSkeleton = skillMeta === null && isLoading;

  const lineCount = useMemo(() => countLines(toolCall.output), [toolCall.output]);
  const resourceCount = useMemo(() => countResources(toolCall.output), [toolCall.output]);

  const sourceStyle = skillMeta?.source_type
    ? SOURCE_STYLE[skillMeta.source_type]
    : null;
  const sourceLabelKey = skillMeta?.source_type
    ? SOURCE_LABEL_KEY[skillMeta.source_type]
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="my-2"
    >
      <div
        className={cn(
          "group relative overflow-hidden rounded-lg border border-l-2 transition-colors duration-200",
          isError
            ? "border-destructive/20 border-l-destructive bg-destructive/5"
            : isComplete
              ? "border-ai-border border-l-accent-purple bg-ai-surface"
              : "border-ai-border border-l-accent-purple bg-ai-surface",
        )}
      >
        {/* Main content */}
        <div className="flex items-start gap-3 px-3.5 py-2.5">
          {/* Icon container */}
          <div
            role="img"
            aria-label={isComplete ? (isError ? t("skills.activity.skillFailed") : t("skills.activity.skillLoaded")) : t("skills.activity.skillLoading")}
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
              isError ? "bg-destructive/5" : "bg-ai-surface",
            )}
          >
            {isComplete ? (
              isError ? (
                <Lightbulb aria-hidden="true" className="h-3.5 w-3.5 text-accent-rose/70" />
              ) : (
                <motion.div
                  initial={{ opacity: 0, rotate: -90 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  transition={{ duration: 0.12, ease: "easeOut", delay: 0.1 }}
                >
                  <Lightbulb aria-hidden="true" className="h-3.5 w-3.5 text-accent-purple" />
                </motion.div>
              )
            ) : (
              <PulsingDot size="sm" />
            )}
          </div>

          {/* Text content */}
          <div className="min-w-0 flex-1">
            {/* Row 1: Name + status + source badge */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {displayName}
              </span>

              {isComplete && !isError && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 rounded-full border-0 bg-ai-surface px-1.5 py-0.5 text-micro font-medium text-accent-purple"
                  >
                    <Check className="h-2.5 w-2.5" />
                    {t("skills.activity.loaded")}
                  </Badge>
                </motion.div>
              )}

              {!isComplete && (
                <Badge variant="secondary" className="rounded-full border-0 bg-accent-purple/10 px-1.5 py-0.5 text-micro font-medium text-accent-purple">
                  {t("skills.activity.loading")}
                </Badge>
              )}

              {isError && (
                <Badge variant="secondary" className="rounded-full border-0 bg-destructive/5 px-1.5 py-0.5 text-micro font-medium text-accent-rose">
                  {t("skills.activity.failed")}
                </Badge>
              )}

              {/* Source type badge — skeleton while loading, real badge when ready */}
              {sourceStyle && sourceLabelKey ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="ml-auto shrink-0"
                >
                  <Badge
                    variant="secondary"
                    className={cn("border-0 px-1.5 py-0 text-micro font-medium", sourceStyle.className)}
                  >
                    {t(sourceLabelKey)}
                  </Badge>
                </motion.div>
              ) : showSkeleton ? (
                <span className="ml-auto shrink-0">
                  <Skeleton className="h-4 w-12" />
                </span>
              ) : null}
            </div>

            {/* Row 2: Description — skeleton while loading, real text when ready, hidden if empty */}
            {showSkeleton ? (
              <div className="mt-1.5 min-h-[18px]">
                <Skeleton className="h-3 w-48" />
              </div>
            ) : skillMeta?.description ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.12 }}
                className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground"
              >
                {skillMeta.description}
              </motion.p>
            ) : null}

            {/* Row 3: Stats row — instructions + resources */}
            {isComplete && !isError && (lineCount > 0 || resourceCount > 0) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-1.5 flex items-center gap-3"
              >
                {lineCount > 0 && (
                  <span className="font-mono text-micro text-muted-foreground-dim">
                    {t("skills.activity.lines", { count: lineCount })}
                  </span>
                )}
                {resourceCount > 0 && (
                  <span className="font-mono text-micro text-muted-foreground-dim">
                    {resourceCount !== 1
                      ? t("skills.activity.resources", { count: resourceCount })
                      : t("skills.activity.resource", { count: resourceCount })}
                  </span>
                )}
              </motion.div>
            )}

            {/* Error message */}
            {isError && toolCall.output && (
              <ErrorMessage output={toolCall.output} t={t} />
            )}
          </div>

          {/* Expand raw toggle */}
          {isComplete && !isError && lineCount > 0 && (
            <button
              type="button"
              onClick={toggleRaw}
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-micro text-muted-foreground-dim transition-colors hover:bg-muted hover:text-muted-foreground"
              aria-label={showRaw ? t("skills.activity.hideInstructions") : t("skills.activity.showInstructions")}
            >
              <motion.span
                animate={{ rotate: showRaw ? 90 : 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center"
              >
                <ChevronRight aria-hidden="true" className="h-3 w-3" />
              </motion.span>
            </button>
          )}
        </div>

        {/* Collapsible raw output */}
        <AnimatePresence>
          {showRaw && toolCall.output && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="border-t border-ai-border px-3.5 py-2">
                <pre className="max-h-48 md:max-h-64 overflow-auto font-mono text-micro leading-relaxed text-muted-foreground-dim">
                  {toolCall.output}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
