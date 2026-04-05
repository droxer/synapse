"use client";

import { useState, useCallback, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

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
  }, []);

  return (
    <div className={cn("overflow-hidden rounded-md border border-[var(--color-terminal-border)]", className)}>
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-surface)] px-3 py-2">
        <span className="font-mono text-xs text-[var(--color-terminal-dim)]">
          {title}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t("output.copied") : t("output.terminalCopy")}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-micro text-[var(--color-terminal-dim)] transition-colors hover:text-[var(--color-terminal-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Terminal body */}
      <div ref={bodyRef} className="bg-[var(--color-terminal-bg)] px-4 py-3 font-mono text-xs leading-relaxed">
        {children}
      </div>
    </div>
  );
}
