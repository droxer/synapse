"use client";

import { useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { ExpandToggle } from "./expand-toggle";

const COLLAPSE_THRESHOLD = 500;

interface HtmlOutputProps {
  readonly output: string;
  readonly className?: string;
  readonly label?: string;
}

export function HtmlOutput({ output, className, label }: HtmlOutputProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);
  const isLong = output.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, COLLAPSE_THRESHOLD) : output;
  const resolvedLabel = label ?? t("a11y.htmlOutput");

  return (
    <div className={cn("rounded-md border border-border/70 bg-muted/50 px-3 py-2", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>{resolvedLabel}</span>
      </div>
      <div className="rounded border border-border bg-background p-2">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
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
  );
}
