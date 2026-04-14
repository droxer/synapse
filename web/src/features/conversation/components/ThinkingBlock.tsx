"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
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
  /** When set, used instead of "Thought for Ns" when not actively thinking (e.g. inline-extracted reasoning). */
  readonly summaryLabel?: string;
}

export function ThinkingBlock({
  content,
  isThinking,
  isTurnStreaming,
  durationMs = 0,
  summaryLabel,
}: ThinkingBlockProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(true);
  const [showBottomFade, setShowBottomFade] = useState(false);
  const wasTurnStreamingRef = useRef(isTurnStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Auto-collapse only when the streaming turn finishes, not when the
  // assistant moves from "thinking" to "writing".
  useEffect(() => {
    if (wasTurnStreamingRef.current && !isTurnStreaming) {
      setExpanded(false);
    }
    wasTurnStreamingRef.current = isTurnStreaming;
  }, [isTurnStreaming]);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    const hasOverflow = el.scrollHeight > el.clientHeight;
    setShowBottomFade(hasOverflow && !isAtBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !expanded) return;

    checkOverflow();
    el.addEventListener("scroll", checkOverflow, { passive: true });
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", checkOverflow);
      observer.disconnect();
    };
  }, [expanded, content, checkOverflow]);

  if (!content) return null;

  const dur = shouldReduceMotion ? 0 : 1;
  const durationSeconds = Math.max(Math.round(durationMs / 1000), 1);
  const label = isThinking
    ? t("thinking.thinking")
    : (summaryLabel ?? t("thinking.thoughtFor", { seconds: durationSeconds }));

  return (
    <div className="overflow-hidden border-l border-border-strong pl-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-caption font-medium tracking-[0.01em] text-muted-foreground transition-colors",
          "hover:bg-muted/50 hover:text-foreground/90",
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
              <div
                ref={scrollRef}
                className={cn(
                  "max-h-96 overflow-y-auto px-2.5 pb-2.5",
                  showBottomFade && "thinking-scroll-mask",
                )}
              >
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
