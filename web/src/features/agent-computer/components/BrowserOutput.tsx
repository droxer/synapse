"use client";

import { useState, useCallback } from "react";
import { Monitor, ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "@/shared/components";
import { ImageOutput } from "@/shared/components/ui/image-output";
import { Progress } from "@/shared/components/ui/progress";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import {
  PROSE_CLASSES,
  TOOL_OUTPUT_MARKDOWN_CLASSES,
  OUTPUT_CARD_BASE_CLASSES,
  OUTPUT_HEADER_ROW_CLASSES,
  OUTPUT_HEADER_LABEL_CLASSES,
} from "../lib/format-tools";
import type { BrowserMetadata } from "@/shared/types";

const COLLAPSE_THRESHOLD = 500;

interface BrowserOutputProps {
  readonly output: string;
  readonly browserMetadata?: BrowserMetadata;
  readonly conversationId?: string | null;
  readonly artifactIds?: string[];
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function BrowserOutput({
  output,
  browserMetadata,
  conversationId,
  artifactIds,
}: BrowserOutputProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isLong = output.length > COLLAPSE_THRESHOLD;
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);

  const displayText = isLong && !expanded ? output.slice(0, COLLAPSE_THRESHOLD) : output;

  const steps = browserMetadata?.steps ?? 0;
  const maxSteps = browserMetadata?.maxSteps ?? 0;
  const isDone = browserMetadata?.isDone ?? false;
  const url = browserMetadata?.url;
  const hostname = url ? extractHostname(url) : null;
  const progressValue = maxSteps > 0 ? Math.round((steps / maxSteps) * 100) : 0;
  const hasScreenshot = artifactIds && artifactIds.length > 0 && conversationId;

  return (
    <div className={OUTPUT_CARD_BASE_CLASSES}>
      {/* Header */}
      <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "mb-2")}>
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={OUTPUT_HEADER_LABEL_CLASSES}>
          {t("output.category.browser")}
        </span>
        {/* Status badge */}
        <span
          className={cn(
            "inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 text-micro font-medium text-muted-foreground",
          )}
        >
          {isDone ? t("output.browser.done") : t("output.browser.incomplete")}
        </span>
        {/* URL pill */}
        {hostname && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-micro text-muted-foreground-dim">
            <ExternalLink className="h-2.5 w-2.5" />
            {hostname}
          </span>
        )}
      </div>

      {/* Screenshot */}
      {hasScreenshot && (
        <ImageOutput
          output=""
          conversationId={conversationId}
          artifactIds={artifactIds}
          className="mb-2"
        />
      )}

      {/* Step progress */}
      {maxSteps > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Progress
            value={progressValue}
            className="h-1.5 flex-1"
            indicatorClassName="bg-foreground"
          />
          <span className="text-micro font-mono text-muted-foreground tabular-nums">
            {t("output.browser.steps", { completed: steps, total: maxSteps })}
          </span>
        </div>
      )}

      {/* Markdown body */}
      <div className={PROSE_CLASSES}>
        <MarkdownRenderer content={displayText} className={TOOL_OUTPUT_MARKDOWN_CLASSES} />
        {isLong && !expanded && (
          <span className="text-muted-foreground-dim">...</span>
        )}
      </div>

      {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
    </div>
  );
}
