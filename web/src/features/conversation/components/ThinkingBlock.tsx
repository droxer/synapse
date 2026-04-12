"use client";

import { useState, useEffect, useRef, useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
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
  const panelId = useId();

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
    <div className="overflow-hidden border-l border-border/50 pl-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-caption font-medium tracking-[0.01em] text-muted-foreground transition-colors",
          "hover:text-foreground/90",
          expanded && "text-foreground/85",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {isThinking && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-focus/90",
              !shouldReduceMotion && "animate-pulse",
            )}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>

        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 * dur }}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-body"
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 * dur, ease: [0.33, 1, 0.68, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-1">
              <div className="max-h-72 overflow-y-auto px-2.5 pb-2.5">
                <div className="border-l border-border/35 pl-3">
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
