"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
  const shouldReduceMotion = useReducedMotion();
  const dur = shouldReduceMotion ? 0 : 1;
  const panelId = useId();

  return (
    <div
      className={cn(
        "mb-4 overflow-hidden border-l border-border/50 pl-2",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "group flex w-full items-center gap-2 px-2.5 py-1.5",
          "text-left text-caption font-medium tracking-[0.01em] text-muted-foreground transition-colors hover:text-foreground/90",
          expanded && "text-foreground/85",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {isLive && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-focus/90",
              !shouldReduceMotion && "animate-pulse",
            )}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate">
          {isLive ? t("progress.reasoningLive") : t("progress.reasoning")}
        </span>

        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 * dur, ease: "easeOut" }}
          className="shrink-0 text-muted-foreground transition-opacity group-hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-content"
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 * dur, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="pt-1">
              <div className="max-h-72 overflow-y-auto px-2.5 pb-2.5">
                <div className="border-l border-border/35 pl-3">
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
