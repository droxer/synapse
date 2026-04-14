"use client";

import { useState, useCallback, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { ExpandToggle } from "./expand-toggle";
import { OUTPUT_COLLAPSE_THRESHOLD } from "@/features/agent-computer/lib/format-tools";

const CODE_OUTPUT_MARKDOWN_CLASSES = "[&_pre]:!text-sm [&_code]:!text-sm";

interface CodeOutputProps {
  readonly output: string;
  readonly icon?: LucideIcon;
  readonly label?: string;
  readonly language?: string;
  readonly className?: string;
}

export function CodeOutput({ output, icon: Icon, label, language, className }: CodeOutputProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleToggle = useCallback(() => setExpanded((p) => !p), []);
  const isLong = output.length > OUTPUT_COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? output.slice(0, OUTPUT_COLLAPSE_THRESHOLD) : output;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — silently degrade
    }
  }, [output]);

  const fenced = useMemo(() => {
    const lang = language ?? "";
    return `\`\`\`${lang}\n${displayText}\n\`\`\``;
  }, [language, displayText]);

  return (
    <div className={cn("rounded-lg border border-border-strong bg-background/70 px-3 py-2", className)}>
      {/* Header row: copy button (left) + category label (right) */}
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t("output.copied") : t("output.copyToClipboard")}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t("output.copied")}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t("output.copy")}
            </>
          )}
        </button>

        {Icon && label && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/20 px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
            <Icon className="h-3 w-3" />
            {label}
          </span>
        )}
      </div>

      {/* Content — rendered via MarkdownRenderer for syntax highlighting */}
      <div className="code-output-content rounded-md bg-muted/10 px-2 py-1.5 [&_.markdown-body]:bg-transparent [&_.markdown-body_pre]:m-0 [&_.markdown-body_pre]:rounded-none [&_.markdown-body_pre]:border-0 [&_.markdown-body_pre]:bg-transparent [&_.markdown-body_pre]:p-0">
        <MarkdownRenderer content={fenced} className={CODE_OUTPUT_MARKDOWN_CLASSES} compactCode />
        {isLong && !expanded && (
          <span className="font-mono text-xs text-muted-foreground-dim">{"\n..."}</span>
        )}
      </div>

      {isLong && (
        <div className="mt-2">
          <ExpandToggle expanded={expanded} onToggle={handleToggle} />
        </div>
      )}
    </div>
  );
}
