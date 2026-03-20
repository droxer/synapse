"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { formatArgValue } from "../lib/format-tools";

const VALUE_TRUNCATE = 120;

interface ToolArgsDisplayProps {
  readonly input: Record<string, unknown>;
  readonly compact?: boolean;
}

function ValueToggle({
  expanded,
  onToggle,
  t,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly t: (key: string) => string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={expanded ? t("a11y.collapse") : t("a11y.expand")}
      className="ml-1 inline-flex items-center text-micro text-muted-foreground hover:text-foreground transition-colors"
    >
      {expanded ? (
        <ChevronUp className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      )}
    </button>
  );
}

export function ToolArgsDisplay({ input, compact = false }: ToolArgsDisplayProps) {
  const { t } = useTranslation();
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const entries = Object.entries(input);
  if (entries.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-md border-l-2 border-border bg-muted font-mono",
        compact ? "px-2 py-1 text-micro" : "px-2.5 py-1.5 text-xs",
      )}
    >
      <div
        className={cn(
          "grid items-start",
          compact
            ? "grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
            : "grid-cols-[auto_1fr] gap-x-3 gap-y-1",
        )}
      >
        {entries.map(([key, value]) => {
          const strValue = formatArgValue(value);
          const isLong = strValue.length > VALUE_TRUNCATE;
          const isExpanded = expandedKeys.has(key);
          const isMultiline =
            typeof value === "object" && value !== null;
          const displayValue =
            isLong && !isExpanded
              ? strValue.slice(0, VALUE_TRUNCATE)
              : strValue;

          return (
            <div key={key} className="contents">
              {/* Key */}
              <span className="select-none text-muted-foreground whitespace-nowrap pt-px">
                {key}
              </span>

              {/* Value */}
              <div className="min-w-0">
                {isMultiline ? (
                  <pre
                    className={cn(
                      "whitespace-pre-wrap break-all text-foreground",
                      compact ? "text-micro" : "text-xs",
                    )}
                  >
                    {displayValue}
                    {isLong && !isExpanded && (
                      <span className="text-muted-foreground">{t("a11y.truncatedChars", { count: strValue.length - VALUE_TRUNCATE })}</span>
                    )}
                  </pre>
                ) : typeof value === "boolean" ? (
                  <span
                    className={
                      value
                        ? "text-accent-emerald"
                        : "text-accent-rose"
                    }
                  >
                    {String(value)}
                  </span>
                ) : (
                  <span className="break-all text-foreground">
                    {displayValue}
                    {isLong && !isExpanded && (
                      <span className="text-muted-foreground">{t("a11y.truncatedChars", { count: strValue.length - VALUE_TRUNCATE })}</span>
                    )}
                  </span>
                )}
                {isLong && (
                  <ValueToggle
                    expanded={isExpanded}
                    onToggle={() => toggleKey(key)}
                    t={t}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
