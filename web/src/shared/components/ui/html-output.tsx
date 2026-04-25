"use client";

import { useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { ExpandToggle } from "./expand-toggle";
import {
  OUTPUT_COLLAPSE_THRESHOLD,
  OUTPUT_SCROLL_AREA_CLASSES,
} from "@/features/agent-computer/lib/format-tools";
import {
  OUTPUT_SURFACE_BODY_CLASSES,
  OUTPUT_SURFACE_HEADER_CLASSES,
  OUTPUT_SURFACE_INNER_CLASSES,
  OUTPUT_SURFACE_LABEL_CLASSES,
  OUTPUT_SURFACE_ROOT_CLASSES,
} from "./output-surface";

interface HtmlOutputProps {
  readonly output: string;
  readonly className?: string;
  readonly label?: string;
}

export function HtmlOutput({ output, className, label }: HtmlOutputProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);
  const isLong = output.length > OUTPUT_COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, OUTPUT_COLLAPSE_THRESHOLD) : output;
  const resolvedLabel = label ?? t("a11y.htmlOutput");

  return (
    <div className={cn(OUTPUT_SURFACE_ROOT_CLASSES, className)}>
      <div className={OUTPUT_SURFACE_HEADER_CLASSES}>
        <FileText className="h-3 w-3 text-muted-foreground" />
        <span className={OUTPUT_SURFACE_LABEL_CLASSES}>{resolvedLabel}</span>
      </div>
      <div className={OUTPUT_SURFACE_BODY_CLASSES}>
        <div className={cn(OUTPUT_SURFACE_INNER_CLASSES, OUTPUT_SCROLL_AREA_CLASSES)}>
          <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-muted-foreground">
            {displayText}
            {isLong && !expanded && "..."}
          </pre>
        </div>
        {isLong && (
          <div className="mt-2">
            <ExpandToggle expanded={expanded} onToggle={handleToggle} />
          </div>
        )}
      </div>
    </div>
  );
}
