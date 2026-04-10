"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { formatArgValue } from "../lib/format-tools";
import { OUTPUT_CARD_DENSE_CLASSES } from "../lib/format-tools";
import type { TFn } from "@/shared/types/i18n";

const VALUE_TRUNCATE = 120;

const ARG_KEY_I18N: Record<string, string> = {
  url: "tools.arg.url",
  task: "tools.arg.task",
  query: "tools.arg.query",
  code: "tools.arg.code",
  language: "tools.arg.language",
  path: "tools.arg.path",
  file_path: "tools.arg.filePath",
  content: "tools.arg.content",
  action: "tools.arg.action",
  name: "tools.arg.name",
  description: "tools.arg.description",
  command: "tools.arg.command",
  x: "tools.arg.x",
  y: "tools.arg.y",
  text: "tools.arg.text",
  old_text: "tools.arg.oldText",
  new_text: "tools.arg.newText",
  pattern: "tools.arg.pattern",
  sql: "tools.arg.sql",
  packages: "tools.arg.packages",
  key: "tools.arg.key",
  value: "tools.arg.value",
  prompt: "tools.arg.prompt",
  aspect_ratio: "tools.arg.aspectRatio",
  max_results: "tools.arg.maxResults",
  max_length: "tools.arg.maxLength",
  filename: "tools.arg.filename",
  output_files: "tools.arg.outputFiles",
  manager: "tools.arg.manager",
};

function normalizeArgKey(key: string, t: TFn): string {
  const i18nKey = ARG_KEY_I18N[key];
  if (i18nKey) {
    const translated = t(i18nKey);
    if (translated !== i18nKey) return translated;
  }
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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
      className="ml-1 inline-flex items-center rounded-lg px-0.5 text-micro text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
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
        OUTPUT_CARD_DENSE_CLASSES,
        "border-l border-border",
        compact ? "px-2 py-1 text-micro" : "text-xs",
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
              <span className="select-none whitespace-nowrap pt-px text-micro text-muted-foreground-dim">
                {normalizeArgKey(key, t)}
              </span>

              {/* Value */}
              <div className="min-w-0">
                {isMultiline ? (
                  <pre
                    className={cn(
                      "whitespace-pre-wrap break-all font-mono text-foreground",
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
                        ? "text-micro text-accent-emerald"
                        : "text-micro text-accent-rose"
                    }
                  >
                    {String(value)}
                  </span>
                ) : (
                  <span className={cn("break-all text-foreground", compact ? "text-micro" : "text-sm")}>
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
