"use client";

import { useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ExpandToggle } from "./expand-toggle";

const COLLAPSE_THRESHOLD = 500;

interface HtmlOutputProps {
  readonly output: string;
  readonly className?: string;
}

export function HtmlOutput({ output, className }: HtmlOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);
  const isLong = output.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, COLLAPSE_THRESHOLD) : output;

  return (
    <div className={cn("rounded-md border-l-2 border-l-transparent bg-muted p-3", className)}>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>HTML output</span>
      </div>
      <div className="rounded border border-border bg-background p-2">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {displayText}
          {isLong && !expanded && "..."}
        </pre>
      </div>
      {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
    </div>
  );
}
