"use client";

import { useCallback, useState } from "react";
import { Monitor } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import {
  OUTPUT_CARD_BASE_CLASSES,
  OUTPUT_HEADER_LABEL_CLASSES,
  OUTPUT_HEADER_ROW_CLASSES,
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
    <div className={cn(OUTPUT_CARD_BASE_CLASSES, "border-l border-l-border-active")}>
      {/* Header */}
      <div className={OUTPUT_HEADER_ROW_CLASSES}>
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={OUTPUT_HEADER_LABEL_CLASSES}>
          {t("output.category.computer")}
        </span>
        <span className="text-micro text-muted-foreground-dim">
          {actionLabel(action)}
        </span>
      </div>

      {/* Action description */}
      <p className="mb-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>

      {/* Screenshot thumbnail */}
      {hasScreenshot && (
        <div className="mb-2 rounded-md bg-muted/10 p-1.5">
          <div className="flex flex-col items-center gap-2">
            {artifactIds.map((aid) => (
              <img
                key={aid}
                src={`/api/conversations/${conversationId}/artifacts/${aid}`}
                alt={t("output.generatedImage")}
                className="max-h-80 rounded-md bg-background object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!hasScreenshot && hasOutputText && (
        <pre className="mb-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {displayText}
          {isLong && !expanded && ELLIPSIS}
        </pre>
      )}

      {!hasScreenshot && !hasOutputText && (
        <p className="text-sm text-muted-foreground">{t("conversation.waiting")}</p>
      )}

      {!hasScreenshot && isLong && (
        <ExpandToggle expanded={expanded} onToggle={handleToggle} />
      )}
    </div>
  );
}

export { formatActionDescription };
