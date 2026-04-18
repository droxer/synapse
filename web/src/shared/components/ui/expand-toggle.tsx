"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/i18n";
import { OUTPUT_SURFACE_FOCUS_CLASSES } from "./output-surface";

interface ExpandToggleProps {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly showLessLabel?: string;
  readonly showMoreLabel?: string;
}

export function ExpandToggle({ expanded, onToggle, showLessLabel, showMoreLabel }: ExpandToggleProps) {
  const { t } = useTranslation();
  const resolvedShowLess = showLessLabel ?? t("a11y.showLess");
  const resolvedShowMore = showMoreLabel ?? t("a11y.showMore");

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground ${OUTPUT_SURFACE_FOCUS_CLASSES}`}
    >
      {expanded ? (
        <>
          <ChevronUp className="h-3 w-3" />
          {resolvedShowLess}
        </>
      ) : (
        <>
          <ChevronDown className="h-3 w-3" />
          {resolvedShowMore}
        </>
      )}
    </button>
  );
}
