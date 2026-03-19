"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

interface ExpandToggleProps {
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

export function ExpandToggle({ expanded, onToggle }: ExpandToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {expanded ? (
        <>
          <ChevronUp className="h-3 w-3" />
          Show less
        </>
      ) : (
        <>
          <ChevronDown className="h-3 w-3" />
          Show more
        </>
      )}
    </button>
  );
}
