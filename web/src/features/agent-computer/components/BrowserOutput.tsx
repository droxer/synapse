"use client";

import { useState, useCallback } from "react";
import { Monitor, ExternalLink } from "lucide-react";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { Progress } from "@/shared/components/ui/progress";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import { cn } from "@/shared/lib/utils";
import {
  OutputSurface,
  OutputSurfaceBody,
  OutputSurfaceHeader,
  OutputSurfaceInner,
} from "@/shared/components/ui/output-surface";
import { ArtifactScreenshotGallery } from "./ArtifactScreenshotGallery";
import {
  PROSE_CLASSES,
  TOOL_OUTPUT_MARKDOWN_CLASSES,
  OUTPUT_COLLAPSE_THRESHOLD,
  OUTPUT_SCROLL_AREA_CLASSES,
} from "../lib/format-tools";
import type { BrowserMetadata } from "@/shared/types";

const ELLIPSIS = "…";

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
  const isLong = output.length > OUTPUT_COLLAPSE_THRESHOLD;
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);

  const displayText = isLong && !expanded ? output.slice(0, OUTPUT_COLLAPSE_THRESHOLD) : output;

  const steps = browserMetadata?.steps ?? 0;
  const maxSteps = browserMetadata?.maxSteps ?? 0;
  const isDone = browserMetadata?.isDone ?? false;
  const url = browserMetadata?.url;
  const hostname = url ? extractHostname(url) : null;
  const progressValue = maxSteps > 0 ? Math.round((steps / maxSteps) * 100) : 0;
  const hasScreenshot = artifactIds && artifactIds.length > 0 && conversationId;

  return (
    <OutputSurface>
      <OutputSurfaceHeader
        icon={<Monitor className="h-3.5 w-3.5 text-muted-foreground" />}
        label={t("output.category.browser")}
        meta={isDone ? t("output.browser.done") : t("output.browser.incomplete")}
        action={
          hostname ? (
            <span className="inline-flex items-center gap-1 text-micro text-muted-foreground-dim">
              <ExternalLink className="h-2.5 w-2.5" />
              {hostname}
            </span>
          ) : null
        }
        className="items-center"
      />

      <OutputSurfaceBody>
        {/* Screenshot */}
        {hasScreenshot && (
          <ArtifactScreenshotGallery
            conversationId={conversationId}
            artifactIds={artifactIds}
            alt={t("output.generatedImage")}
          />
        )}

        {/* Step progress */}
        {maxSteps > 0 && (
          <div className="mb-2 flex items-center gap-2">
            <Progress value={progressValue} className="h-1.5 flex-1" indicatorClassName="bg-focus" />
            <span className="text-micro font-mono text-muted-foreground tabular-nums">
              {t("output.browser.steps", { completed: steps, total: maxSteps })}
            </span>
          </div>
        )}

        {/* Markdown body */}
        <OutputSurfaceInner className={cn(PROSE_CLASSES, OUTPUT_SCROLL_AREA_CLASSES)}>
          {displayText.trim().length > 0 ? (
            <MarkdownRenderer content={displayText} className={TOOL_OUTPUT_MARKDOWN_CLASSES} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("conversation.waiting")}</p>
          )}
          {isLong && !expanded && (
            <span className="text-muted-foreground-dim">{ELLIPSIS}</span>
          )}
        </OutputSurfaceInner>

        {isLong && (
          <div className="mt-2">
            <ExpandToggle expanded={expanded} onToggle={handleToggle} />
          </div>
        )}
      </OutputSurfaceBody>
    </OutputSurface>
  );
}
