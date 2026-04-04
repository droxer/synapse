"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface ThinkingBlockProps {
  content: string;
  /** Whether the agent is still actively thinking (live streaming). */
  isLive?: boolean;
  className?: string;
}

export function ThinkingBlock({ content, isLive = false, className }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        // Left-border accent, subtle background — Gemini/Manus style
        "mb-3 border-l-2 pl-3",
        isLive
          ? "border-accent-amber/60"
          : "border-border-strong",
        className,
      )}
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "group flex items-center gap-1.5 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm",
        )}
        aria-expanded={expanded}
      >
        <Brain
          className={cn(
            "h-3 w-3 shrink-0",
            isLive ? "text-accent-amber animate-pulse" : "text-muted-foreground-dim",
          )}
        />
        <span
          className={cn(
            "text-xs font-medium",
            isLive ? "text-accent-amber" : "text-muted-foreground-dim",
          )}
        >
          {isLive ? t("progress.reasoningLive") : t("progress.reasoning")}
        </span>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex items-center opacity-60 group-hover:opacity-100 transition-opacity"
        >
          <ChevronDown className="h-3 w-3 text-muted-foreground-dim" />
        </motion.span>
      </button>

      {/* Expandable thinking content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2 max-h-60 overflow-y-auto pr-1">
              <p className="whitespace-pre-wrap font-mono text-[11px] italic leading-relaxed text-muted-foreground opacity-75">
                {content}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
