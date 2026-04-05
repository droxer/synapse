"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Brain, ChevronDown } from "lucide-react";
import { MarkdownRenderer } from "@/shared/components";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface ThinkingBlockProps {
  readonly content: string;
  readonly isThinking: boolean;
  readonly isTurnStreaming: boolean;
  readonly durationMs?: number;
}

export function ThinkingBlock({
  content,
  isThinking,
  isTurnStreaming,
  durationMs = 0,
}: ThinkingBlockProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(true);
  const wasTurnStreamingRef = useRef(isTurnStreaming);

  // Auto-collapse only when the streaming turn finishes, not when the
  // assistant moves from "thinking" to "writing".
  useEffect(() => {
    if (wasTurnStreamingRef.current && !isTurnStreaming) {
      setExpanded(false);
    }
    wasTurnStreamingRef.current = isTurnStreaming;
  }, [isTurnStreaming]);

  if (!content) return null;

  const dur = shouldReduceMotion ? 0 : 1;
  const durationSeconds = Math.max(Math.round(durationMs / 1000), 1);
  const label = isThinking
    ? t("thinking.thinking")
    : t("thinking.thoughtFor", { seconds: durationSeconds });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Header — same shell as PlanChecklistPanel; badge matches AssistantLoadingSkeleton */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          "hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <div
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm font-medium",
            "bg-muted text-muted-foreground",
          )}
        >
          <motion.span
            animate={isThinking && !shouldReduceMotion ? { opacity: [0.5, 1, 0.5] } : {}}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <Brain className="h-3 w-3" />
          </motion.span>
          <span>{label}</span>
          {isThinking && (
            <span className="flex items-center gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="inline-block h-1 w-1 rounded-full bg-muted-foreground"
                  animate={shouldReduceMotion ? {} : { opacity: [0.3, 1, 0.3] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1" />

        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 * dur }}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 * dur, ease: [0.33, 1, 0.68, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border bg-muted/40">
              <div className="max-h-72 overflow-y-auto px-4 py-3">
                <div className="border-l-2 border-border pl-3">
                  <MarkdownRenderer
                    content={content}
                    isStreaming={isThinking}
                    className="markdown-reasoning"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
