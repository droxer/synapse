"use client";

import { useState, useCallback, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import {
  OUTPUT_SURFACE_BODY_CLASSES,
  OUTPUT_SURFACE_FOCUS_CLASSES,
  OUTPUT_SURFACE_HEADER_CLASSES,
  OUTPUT_SURFACE_INNER_CLASSES,
  OUTPUT_SURFACE_LABEL_CLASSES,
  OUTPUT_SURFACE_ROOT_CLASSES,
} from "./output-surface";

/**
 * Strip ANSI escape sequences from terminal output.
 * Handles SGR (colors/styles), cursor movement, erase, OSC, and other CSI codes.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

interface TerminalWindowProps {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  /** Plain text content for the copy button. When omitted, copies from the body element. */
  readonly copyText?: string;
}

export function TerminalWindow({ title, children, className, copyText }: TerminalWindowProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const handleCopy = useCallback(async () => {
    const text = copyText ?? bodyRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — silently degrade
    }
  }, [copyText]);

  return (
    <div className={cn(OUTPUT_SURFACE_ROOT_CLASSES, className)}>
      {/* Title bar */}
      <div className={cn(OUTPUT_SURFACE_HEADER_CLASSES, "justify-between")}>
        <span className={cn(OUTPUT_SURFACE_LABEL_CLASSES, "font-mono text-[var(--color-terminal-dim)]")}>
          {title}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t("output.copied") : t("output.terminalCopy")}
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-[var(--color-terminal-dim)] transition-colors hover:bg-background hover:text-[var(--color-terminal-text)]",
            OUTPUT_SURFACE_FOCUS_CLASSES,
          )}
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Terminal body */}
      <div className={OUTPUT_SURFACE_BODY_CLASSES}>
        <div
          ref={bodyRef}
          className={cn(
            OUTPUT_SURFACE_INNER_CLASSES,
            "overflow-hidden border-terminal-border bg-[var(--color-terminal-bg)] px-3 py-2.5 font-mono text-sm leading-relaxed",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
