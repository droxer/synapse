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
    <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
      {/* Header — badge + toggle */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
      >
        {/* Badge — matches AssistantLoadingSkeleton thinking phase */}
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
            "bg-secondary border-border text-accent-amber",
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
                  className="inline-block h-1 w-1 rounded-full bg-accent-amber"
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

        <div className="flex-1" />

        {/* Chevron rotates on expand */}
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 * dur }}
          className="text-muted-foreground-dim"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      {/* Collapsible body */}
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
            <div className="mt-2 border-t border-border pt-2">
              <div className="max-h-80 overflow-y-auto">
                <MarkdownRenderer content={content} className="text-muted-foreground-dim" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
