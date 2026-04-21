"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
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
  // Collapsed by default; auto-expand only while actively thinking.
  const [expanded, setExpanded] = useState(isThinking || isTurnStreaming);
  const [showBottomFade, setShowBottomFade] = useState(false);
  const wasTurnStreamingRef = useRef(isTurnStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Auto-expand when thinking starts, auto-collapse when streaming turn finishes.
  useEffect(() => {
    if (isThinking) {
      setExpanded(true);
    }
  }, [isThinking]);

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

  // Throttled version for high-frequency observers (ResizeObserver, scroll)
  const rafRef = useRef<number | null>(null);
  const throttledCheckOverflow = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      checkOverflow();
    });
  }, [checkOverflow]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !expanded) return;

    checkOverflow();
    el.addEventListener("scroll", throttledCheckOverflow, { passive: true });
    const observer = new ResizeObserver(throttledCheckOverflow);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", throttledCheckOverflow);
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [expanded, content, checkOverflow, throttledCheckOverflow]);

  if (!content) return null;

  const dur = shouldReduceMotion ? 0 : 1;
  const durationSeconds = Math.max(Math.round(durationMs / 1000), 1);
  const label = isThinking
    ? t("thinking.thinking")
    : summaryLabel
      ? summaryLabel
      : durationMs > 0
        ? t("thinking.thoughtFor", { seconds: durationSeconds })
        : t("thinking.reasoning");
  const steps = parseThinkingTimeline(content);
  const isMultiStep = steps.length > 1 || steps.some((step) => step.title);

  // Collapsed preview: first meaningful line of content
  const previewSnippet = !expanded && !isThinking
    ? content.replace(/^#+\s*/m, "").split("\n").filter((l) => l.trim().length > 0)[0]?.trim().slice(0, 60) ?? ""
    : "";

  return (
    <div data-thinking-block="" className="group/thinking">
      {/* Toggle header — inline text with subtle hover */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 -ml-2 text-left text-caption text-muted-foreground transition-colors duration-150",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        )}
      >
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.12 * dur }}
          className="shrink-0"
        >
          <ChevronRight className="h-3 w-3" />
        </motion.span>

        {isThinking && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-focus",
              !shouldReduceMotion && "animate-pulse",
            )}
            aria-hidden="true"
          />
        )}

        <span className="font-medium">{label}</span>

        {!expanded && isMultiStep && !isThinking && (
          <span className="text-muted-foreground-dim">
            &middot; {steps.length} steps
          </span>
        )}

        {previewSnippet && !expanded && (
          <span className="hidden min-w-0 flex-1 truncate text-muted-foreground-dim sm:block">
            &mdash; {previewSnippet}{previewSnippet.length >= 60 ? "..." : ""}
          </span>
        )}
      </button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-body"
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 * dur, ease: [0.33, 1, 0.68, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={scrollRef}
              data-thinking-panel=""
              className={cn(
                "mt-1.5 max-h-80 overflow-y-auto rounded-lg bg-muted/50 px-3.5 py-3",
                showBottomFade && "thinking-scroll-mask",
              )}
            >
              {isMultiStep ? (
                <div data-thinking-mode="steps" className="space-y-2.5">
                  {steps.map((step, idx) => (
                    <section
                      key={step.id}
                      data-thinking-step={idx + 1}
                      className={cn(
                        idx > 0 && "pt-2.5",
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="chip-muted inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md font-mono text-micro font-semibold"
                          aria-hidden="true"
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          {step.title ? (
                            <h3 className="text-sm font-medium text-foreground">
                              {step.title}
                            </h3>
                          ) : null}
                          <div className={cn(step.title && "mt-1")}>
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
                <MarkdownRenderer
                  content={steps[0]?.body ?? content}
                  isStreaming={isThinking}
                  className="markdown-reasoning"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
