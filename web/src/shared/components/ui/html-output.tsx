"use client";

import { useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { ExpandToggle } from "./expand-toggle";
import { OUTPUT_COLLAPSE_THRESHOLD } from "@/features/agent-computer/lib/format-tools";

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
    <div className={cn("rounded-lg border border-border-strong bg-background/70 px-3 py-2", className)}>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>{resolvedLabel}</span>
      </div>
      <div className="rounded-md bg-muted/10 px-2 py-1.5">
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
  );
}
