"use client";

import { useCallback, useState } from "react";
import { Monitor } from "lucide-react";
import { useTranslation } from "@/i18n";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import {
  OutputSurface,
  OutputSurfaceBody,
  OutputSurfaceHeader,
  OutputSurfaceInner,
} from "@/shared/components/ui/output-surface";
import { ArtifactScreenshotGallery } from "./ArtifactScreenshotGallery";
import {
  OUTPUT_COLLAPSE_THRESHOLD,
} from "../lib/format-tools";
import type { ComputerUseMetadata } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

const ELLIPSIS = "…";

function formatActionDescription(
  meta: ComputerUseMetadata | undefined,
  toolName: string,
  t: TFn,
): string {
  if (!meta?.action || toolName === "computer_screenshot") {
    return t("output.computer.screenshot");
  }

  const { action, x, y, text, endX, endY } = meta;

  switch (action) {
    case "click":
      return x != null && y != null
        ? t("output.computer.click", { x, y })
        : t("output.computer.click", { x: 0, y: 0 });
    case "double_click":
      return x != null && y != null
        ? t("output.computer.double_click", { x, y })
        : t("output.computer.double_click", { x: 0, y: 0 });
    case "right_click":
      return x != null && y != null
        ? t("output.computer.right_click", { x, y })
        : t("output.computer.right_click", { x: 0, y: 0 });
    case "type":
      return text ? t("output.computer.type", { text }) : t("output.computer.type", { text: "" });
    case "key":
      return text ? t("output.computer.key", { text }) : t("output.computer.key", { text: "" });
    case "scroll_up":
      return t("output.computer.scroll_up");
    case "scroll_down":
      return t("output.computer.scroll_down");
    case "move":
      return x != null && y != null
        ? t("output.computer.move", { x, y })
        : t("output.computer.move", { x: 0, y: 0 });
    case "drag":
      return x != null && y != null && endX != null && endY != null
        ? t("output.computer.drag", { x, y, endX, endY })
        : t("output.computer.drag", { x: 0, y: 0, endX: 0, endY: 0 });
    default:
      return `${action}`;
  }
}

/** Human-readable action label for badges */
function actionLabel(action?: string): string {
  if (!action) return "screenshot";
  return action.replace(/_/g, " ");
}

interface ComputerUseOutputProps {
  readonly output: string;
  readonly computerUseMetadata?: ComputerUseMetadata;
  readonly toolName: string;
  readonly conversationId?: string | null;
  readonly artifactIds?: string[];
}

export function ComputerUseOutput({
  output,
  computerUseMetadata,
  toolName,
  conversationId,
  artifactIds,
}: ComputerUseOutputProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), []);

  const description = formatActionDescription(computerUseMetadata, toolName, t);
  const hasScreenshot = artifactIds && artifactIds.length > 0 && conversationId;
  const action = computerUseMetadata?.action;
  const isLong = output.length > OUTPUT_COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, OUTPUT_COLLAPSE_THRESHOLD) : output;
  const hasOutputText = displayText.trim().length > 0;

  return (
    <OutputSurface>
      <OutputSurfaceHeader
        icon={<Monitor className="h-3.5 w-3.5 text-muted-foreground" />}
        label={t("output.category.computer")}
        meta={actionLabel(action)}
      />

      <OutputSurfaceBody>
        {/* Action description */}
        <p className="mb-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>

        {/* Screenshot thumbnail */}
        {hasScreenshot && (
          <ArtifactScreenshotGallery
            conversationId={conversationId}
            artifactIds={artifactIds}
            alt={t("output.generatedImage")}
          />
        )}

        {!hasScreenshot && hasOutputText && (
          <OutputSurfaceInner className="overflow-x-auto">
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
              {displayText}
              {isLong && !expanded && ELLIPSIS}
            </pre>
          </OutputSurfaceInner>
        )}

        {!hasScreenshot && !hasOutputText && (
          <p className="text-sm text-muted-foreground">{t("conversation.waiting")}</p>
        )}

        {!hasScreenshot && isLong && (
          <ExpandToggle expanded={expanded} onToggle={handleToggle} />
        )}
      </OutputSurfaceBody>
    </OutputSurface>
  );
}

export { formatActionDescription };
