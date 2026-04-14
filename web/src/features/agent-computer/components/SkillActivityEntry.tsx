"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Check, CircleX } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { normalizeSkillName } from "@/features/skills/lib/normalize-skill-name";
import { SOURCE_STYLE, SOURCE_LABEL_KEY } from "@/features/skills/lib/skill-source-styles";
import { useSkillsCache } from "@/features/skills/hooks/use-skills-cache";
import { useTranslation } from "@/i18n";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { EVENT_ROW_BASE_CLASSES } from "../lib/format-tools";
import { getSkillIcon } from "../lib/tool-visual-icons";
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
      <p className={cn("text-sm leading-relaxed text-destructive", !expanded && "line-clamp-2")}>
        {expanded ? output : output.slice(0, 200)}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="mt-0.5 rounded text-micro font-medium text-destructive transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
  const isResolved = toolCall.success !== undefined;
  const isComplete = toolCall.success === true;
  const isError = toolCall.success === false;

  const SkillGlyph = useMemo(() => getSkillIcon(skillName), [skillName]);

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
          "group relative overflow-hidden border-l border-l-border transition-colors duration-150",
          EVENT_ROW_BASE_CLASSES,
        )}
      >
        {/* Main content */}
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          {/* Icon container */}
          <div
            role="img"
            aria-label={isError ? t("skills.activity.skillFailed") : isComplete ? t("skills.activity.skillLoaded") : t("skills.activity.skillLoading")}
            className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted"
          >
            {isError ? (
              <>
                <SkillGlyph aria-hidden="true" className="h-3.5 w-3.5 text-destructive" strokeWidth={2.25} />
                <CircleX
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-destructive"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </>
            ) : isComplete ? (
              <motion.div
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                transition={{ duration: 0.12, ease: "easeOut", delay: 0.1 }}
                className="relative flex items-center justify-center"
              >
                <SkillGlyph aria-hidden="true" className="h-3.5 w-3.5 text-accent-emerald" strokeWidth={2.25} />
                <Check
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-accent-emerald"
                  strokeWidth={3}
                  aria-hidden
                />
              </motion.div>
            ) : (
              <>
                <SkillGlyph aria-hidden="true" className="h-3.5 w-3.5 text-focus" strokeWidth={2.25} />
                <span
                  className="pointer-events-none absolute inset-0 rounded-md animate-pulsing-dot-fade"
                  style={{ backgroundColor: "color-mix(in srgb, var(--color-focus) 18%, transparent)" }}
                  aria-hidden
                />
              </>
            )}
          </div>

          {/* Text content */}
          <div className="min-w-0 flex-1">
            {/* Row 1: Name + status + source badge */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {displayName}
              </span>

              {isComplete && !isError && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <span className="status-pill chip-muted text-accent-emerald">
                    <Check className="h-2.5 w-2.5" />
                    {t("skills.activity.loaded")}
                  </span>
                </motion.div>
              )}

              {!isResolved && (
                <span className="status-pill chip-muted">
                  {t("skills.activity.loading")}
                </span>
              )}

              {isError && (
                <span className="status-pill chip-muted text-destructive">
                  {t("skills.activity.failed")}
                </span>
              )}

              {/* Source type badge — skeleton while loading, real badge when ready */}
              {sourceStyle && sourceLabelKey ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="ml-auto shrink-0"
                >
                  <span className={cn("rounded-md px-1.5 py-0 text-micro font-medium", sourceStyle.className)}>
                    {t(sourceLabelKey)}
                  </span>
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
                className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground"
              >
                {skillMeta.description}
              </motion.p>
            ) : null}

            {/* Row 3: Stats row — instructions + resources */}
            {isComplete && (lineCount > 0 || resourceCount > 0) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              className="mt-1.5 flex items-center gap-2.5"
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
          {isResolved && !isError && lineCount > 0 && (
            <button
              type="button"
              onClick={toggleRaw}
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-micro text-muted-foreground-dim transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
              <div className="border-t border-border px-3.5 py-2">
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
