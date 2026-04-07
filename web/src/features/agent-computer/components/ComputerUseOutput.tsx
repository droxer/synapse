"use client";

import { useCallback, useState } from "react";
import { Monitor } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { ImageOutput } from "@/shared/components/ui/image-output";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import {
  OUTPUT_CARD_BASE_CLASSES,
  OUTPUT_HEADER_LABEL_CLASSES,
  OUTPUT_HEADER_ROW_CLASSES,
} from "../lib/format-tools";
import type { ComputerUseMetadata } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

const COLLAPSE_THRESHOLD = 500;
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
  const isLong = output.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, COLLAPSE_THRESHOLD) : output;
  const hasOutputText = displayText.trim().length > 0;

  return (
    <div className={OUTPUT_CARD_BASE_CLASSES}>
      {/* Header */}
      <div className={OUTPUT_HEADER_ROW_CLASSES}>
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={OUTPUT_HEADER_LABEL_CLASSES}>
          {t("output.category.computer")}
        </span>
        {/* Action badge */}
        <span className={cn(
          "inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 text-micro font-medium text-muted-foreground",
        )}>
          {actionLabel(action)}
        </span>
      </div>

      {/* Action description */}
      <p className="mb-1.5 text-sm text-muted-foreground">{description}</p>

      {/* Screenshot thumbnail */}
      {hasScreenshot && (
        <ImageOutput
          output=""
          conversationId={conversationId}
          artifactIds={artifactIds}
          className="mb-1"
        />
      )}

      {!hasScreenshot && hasOutputText && (
        <pre className="mb-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {displayText}
          {isLong && !expanded && ELLIPSIS}
        </pre>
      )}

      {!hasScreenshot && !hasOutputText && (
        <p className="text-xs text-muted-foreground">{t("conversation.waiting")}</p>
      )}

      {!hasScreenshot && isLong && (
        <ExpandToggle expanded={expanded} onToggle={handleToggle} />
      )}
    </div>
  );
}

export { formatActionDescription };
