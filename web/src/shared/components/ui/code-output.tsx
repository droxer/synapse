"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { ExpandToggle } from "./expand-toggle";

const COLLAPSE_THRESHOLD = 500;
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
  const rootRef = useRef<HTMLDivElement>(null);
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

  const fenced = useMemo(() => {
    const lang = language ?? "";
    return `\`\`\`${lang}\n${displayText}\n\`\`\``;
  }, [language, displayText]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const firstPre = root.querySelector("pre");
    const firstCode = root.querySelector("code");
    const firstInlineCode = root.querySelector("p code");
    const getMetrics = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return null;
      const style = window.getComputedStyle(element);
      return {
        className: element.className,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontFamily: style.fontFamily,
      };
    };
    // #region agent log
    fetch("http://127.0.0.1:7800/ingest/f3cbd1e5-6b99-4559-90b9-9eaeb44e6deb", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "157ac9" }, body: JSON.stringify({ sessionId: "157ac9", runId: "initial", hypothesisId: "H3", location: "code-output.tsx:render-metrics", message: "Captured code output typography metrics", data: { language: language ?? "text", wrapperClassName: root.className, markdownClassOverride: CODE_OUTPUT_MARKDOWN_CLASSES, preMetrics: getMetrics(firstPre), codeMetrics: getMetrics(firstCode), inlineCodeMetrics: getMetrics(firstInlineCode) }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
  }, [displayText, language]);

  return (
    <div ref={rootRef} className={cn("rounded-md border-l-2 border-l-border-strong bg-muted px-3 py-2", className)}>
      {/* Header row: copy button (left) + category label (right) */}
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t("output.copied") : t("output.copyToClipboard")}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-micro text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
          <span className="flex items-center gap-1 text-micro text-muted-foreground-dim">
            <Icon className="h-3 w-3" />
            {label}
          </span>
        )}
      </div>

      {/* Content — rendered via MarkdownRenderer for syntax highlighting */}
      <div className="code-output-content [&_.markdown-body]:bg-transparent [&_.markdown-body_pre]:m-0 [&_.markdown-body_pre]:rounded-none [&_.markdown-body_pre]:border-0 [&_.markdown-body_pre]:bg-transparent [&_.markdown-body_pre]:p-0">
        <MarkdownRenderer content={fenced} className={CODE_OUTPUT_MARKDOWN_CLASSES} />
        {isLong && !expanded && (
          <span className="font-mono text-xs text-muted-foreground-dim">{"\n..."}</span>
        )}
      </div>

      {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
    </div>
  );
}
