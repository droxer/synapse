"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ThinkingBlockProps {
  content: string;
  /** True while the agent is still actively generating this thinking text. */
  isLive?: boolean;
  className?: string;
}

export function ThinkingBlock({ content, isLive = false, className }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "mb-4 overflow-hidden rounded-lg",
        "border border-border bg-secondary",
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className={cn(
          "group flex w-full items-center gap-2 px-3 py-2.5",
          "text-left transition-colors hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {/* Brain icon — pulsing amber when live, muted when done */}
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
            isLive ? "bg-accent-amber/10" : "bg-border",
          )}
        >
          <Brain
            className={cn(
              "h-3 w-3",
              isLive
                ? "animate-[pulsingDotFade_2s_ease-in-out_infinite] text-accent-amber"
                : "text-muted-foreground",
            )}
          />
        </span>

        <span
          className={cn(
            "flex-1 text-xs font-medium",
            isLive ? "text-accent-amber" : "text-muted-foreground",
          )}
        >
          {isLive ? t("progress.reasoningLive") : t("progress.reasoning")}
        </span>

        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex shrink-0 items-center opacity-50 transition-opacity group-hover:opacity-80"
        >
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </motion.span>
      </button>

      {/* ── Expandable content ──────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-content"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border bg-muted">
              <div className="max-h-72 overflow-y-auto px-4 py-4">
                <div className="pl-3 border-l-2 border-muted">
                  <MarkdownRenderer content={content} isStreaming={isLive} className="markdown-reasoning" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
