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
        "mb-4 overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className={cn(
          "group flex w-full items-center gap-3 px-4 py-3",
          "text-left transition-colors hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <div
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm font-medium",
            "bg-muted text-muted-foreground",
          )}
        >
          <Brain
            className={cn(
              "h-3 w-3",
              isLive && "animate-[pulsingDotFade_2s_ease-in-out_infinite]",
            )}
          />
          <span>
            {isLive ? t("progress.reasoningLive") : t("progress.reasoning")}
          </span>
        </div>

        <div className="min-w-0 flex-1" />

        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="shrink-0 text-muted-foreground transition-opacity group-hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

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
            <div className="border-t border-border bg-muted/40">
              <div className="max-h-72 overflow-y-auto px-4 py-3">
                <div className="border-l-2 border-border pl-3">
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
