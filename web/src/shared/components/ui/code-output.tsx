"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ExpandToggle } from "./expand-toggle";

const COLLAPSE_THRESHOLD = 500;

interface CodeOutputProps {
  readonly output: string;
  readonly icon?: LucideIcon;
  readonly label?: string;
  readonly className?: string;
}

export function CodeOutput({ output, icon: Icon, label, className }: CodeOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);
  const isLong = output.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, COLLAPSE_THRESHOLD) : output;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — silently degrade
    }
  }, [output]);

  return (
    <div className={cn("rounded-md border-l-2 border-l-accent-emerald bg-muted px-3 py-2", className)}>
      {/* Header row: copy button (left) + category label (right) */}
      <div className="mb-1.5 flex items-center justify-between">
        {output.length > 50 ? (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy to clipboard"}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-micro text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        ) : (
          <span />
        )}

        {Icon && label && (
          <span className="flex items-center gap-1 text-micro text-muted-foreground-dim">
            <Icon className="h-3 w-3" />
            {label}
          </span>
        )}
      </div>

      {/* Content */}
      <pre
        className={cn(
          "whitespace-pre-wrap font-mono text-xs leading-relaxed",
          "text-accent-emerald",
        )}
      >
        {displayText}
        {isLong && !expanded && (
          <span className="text-muted-foreground-dim">{"\n..."}</span>
        )}
      </pre>

      {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
    </div>
  );
}
