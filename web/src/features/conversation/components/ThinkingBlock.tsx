"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Brain, ChevronDown } from "lucide-react";
import { MarkdownRenderer } from "@/shared/components";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { parseThinkingTimeline } from "../lib/parse-thinking-timeline";

interface ThinkingBlockProps {
  readonly content: string;
  readonly isThinking: boolean;
  readonly isTurnStreaming: boolean;
  readonly durationMs?: number;
  /** When set, used instead of "Thought for Ns" when not actively thinking (e.g. inline-extracted reasoning). */
  readonly summaryLabel?: string;
}

export function getNextThinkingBlockExpanded(previousExpanded: boolean, wasTurnStreaming: boolean, isTurnStreaming: boolean): boolean {
  if (wasTurnStreaming && !isTurnStreaming) {
    return false;
  }
  return previousExpanded;
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
    setExpanded((prev) => getNextThinkingBlockExpanded(prev, wasTurnStreamingRef.current, isTurnStreaming));
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
  const steps = parseThinkingTimeline(content);
  const isMultiStep = steps.length > 1 || steps.some((step) => step.title);
  const leadingVisual = isThinking
    ? (
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full bg-focus",
          !shouldReduceMotion && "animate-pulse",
        )}
        aria-hidden="true"
      />
    )
    : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />;

  return (
    <section
      data-thinking-block=""
      className={cn(
        "overflow-hidden rounded-xl border border-ai-border bg-ai-surface transition-[border-color,background-color,box-shadow] duration-150",
        expanded && "bg-ai-surface shadow-[var(--shadow-card)]",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-caption font-medium tracking-[0.01em] text-muted-foreground transition-[background-color,color]",
          "hover:bg-muted hover:text-foreground",
          expanded && "text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {leadingVisual}
          <span
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md border border-ai-border bg-background",
              expanded && "text-foreground",
            )}
            aria-hidden="true"
          >
            <Brain className="h-3.5 w-3.5" />
          </span>
        </span>
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
            <div className="px-3 pb-3 pt-0.5">
              <div
                ref={scrollRef}
                data-thinking-panel=""
                className={cn(
                  "max-h-96 overflow-y-auto rounded-lg border border-ai-border bg-background p-3",
                  showBottomFade && "thinking-scroll-mask",
                )}
              >
                {isMultiStep ? (
                  <div data-thinking-mode="steps" className="space-y-3">
                    {steps.map((step, idx) => (
                      <section
                        key={step.id}
                        data-thinking-step={idx + 1}
                        className={cn(
                          "rounded-lg border border-transparent px-0.5 py-0.5",
                          idx > 0 && "border-t border-ai-border pt-3",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
                            aria-hidden="true"
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            {step.title ? (
                              <h3 className="text-sm font-medium text-foreground/90">
                                {step.title}
                              </h3>
                            ) : null}
                            <div className={cn(step.title && "mt-1.5")}>
                              <MarkdownRenderer
                                content={step.body}
                                isStreaming={isThinking}
                                className="markdown-reasoning"
                              />
                            </div>
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div data-thinking-mode="note" className="rounded-lg border border-ai-border bg-ai-surface px-3 py-2.5">
                    <MarkdownRenderer
                      content={steps[0]?.body ?? content}
                      isStreaming={isThinking}
                      className="markdown-reasoning"
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
