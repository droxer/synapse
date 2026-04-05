"use client";

import { Monitor } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { ImageOutput } from "@/shared/components/ui/image-output";
import type { ComputerUseMetadata } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

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
  computerUseMetadata,
  toolName,
  conversationId,
  artifactIds,
}: ComputerUseOutputProps) {
  const { t } = useTranslation();

  const description = formatActionDescription(computerUseMetadata, toolName, t);
  const hasScreenshot = artifactIds && artifactIds.length > 0 && conversationId;
  const action = computerUseMetadata?.action;

  return (
    <div className="mt-2.5 rounded-md border-l-2 border-l-border-strong bg-muted px-2.5 py-1.5">
      {/* Header */}
      <div className="mb-1.5 flex items-center gap-2">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
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
    </div>
  );
}

export { formatActionDescription };
