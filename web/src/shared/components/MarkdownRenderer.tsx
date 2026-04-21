"use client";

import { memo, useState, useCallback, useEffect, useRef, useMemo, isValidElement, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import { Copy, Check, ArrowUpRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import {
  getMarkdownRenderStrategy,
  splitStreamingMarkdown,
  type MarkdownRenderStrategy,
} from "./markdown-render-strategy";

// Helper to recursively extract text from React children
const extractText = (node: ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return node.toString();
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const props = node.props;
    if (props && props.children) {
      return extractText(props.children);
    }
  }
  return "";
};

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  const label = copied ? t("markdown.copied") : t("markdown.copyCode");

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      aria-label={label}
      title={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-accent-emerald" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function PreComponent({ children }: { children: ReactNode }) {
  let language = "text";

  if (isValidElement<{ className?: string }>(children)) {
    const className = children.props.className;
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      language = match[1];
    }
  }

  const codeString = useMemo(() => extractText(children), [children]);

  return (
    <div className="relative my-4 overflow-hidden rounded-xl border border-border-strong bg-secondary not-prose shadow-card">
      <div className="flex items-center justify-between border-b border-border-strong bg-muted px-4 py-1.5 font-mono text-[length:var(--md-code-font-size,var(--text-sm))] text-muted-foreground">
        <span>{language}</span>
        <CopyButton text={codeString} />
      </div>
      <pre className="p-4 overflow-x-auto text-[length:var(--md-code-font-size,var(--text-sm))] font-mono bg-transparent m-0 border-none">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    return <PreComponent>{children}</PreComponent>;
  },
  code({ className, children, ...props }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded-lg border border-border-strong bg-muted px-1.5 py-0.5 text-[length:var(--md-code-font-size,var(--text-sm))] font-mono text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // Table components can mostly fall back to Tailwind typography's styling,
  // but we keep custom border styling to maintain the previous crisp look.
  table({ children }) {
    return (
      <div className="overflow-x-auto my-6 not-prose">
        <table className="min-w-full border-collapse text-sm">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border border-border bg-muted px-3 py-1.5 text-left font-medium">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border border-border px-3 py-1.5">{children}</td>
    );
  },
  a({ href, children }) {
    const isExternal = href?.startsWith("http://") || href?.startsWith("https://");
    return (
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className="inline-flex items-center gap-0.5 text-focus underline underline-offset-2 hover:text-focus/80"
      >
        {children}
        {isExternal && (
          <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
      </a>
    );
  },
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  compactCode?: boolean;
  mode?: MarkdownRenderStrategy;
}

const LIGHTWEIGHT_INLINE_RE = /(`[^`\n]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*|__([^_\n]+)__)|(\*([^*\n]+)\*|_([^_\n]+)_)/g;

function renderLightweightInlineMarkdown(content: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  for (const match of content.matchAll(LIGHTWEIGHT_INLINE_RE)) {
    const fullMatch = match[0];
    const matchStart = match.index ?? 0;

    if (matchStart > cursor) {
      nodes.push(
        <span key={`${keyPrefix}-text-${matchIndex}`}>{content.slice(cursor, matchStart)}</span>,
      );
      matchIndex += 1;
    }

    if (match[1]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${matchIndex}`}
          className="rounded-lg border border-border-strong bg-muted px-1.5 py-0.5 text-[length:var(--md-code-font-size,var(--text-sm))] font-mono text-foreground"
        >
          {fullMatch.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      const href = match[4] ?? "";
      const isExternal = href.startsWith("http://") || href.startsWith("https://");
      nodes.push(
        <a
          key={`${keyPrefix}-link-${matchIndex}`}
          href={href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="inline-flex items-center gap-0.5 text-focus underline underline-offset-2 hover:text-focus/80"
        >
          {match[3]}
        </a>,
      );
    } else if (match[5]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${matchIndex}`} className="font-semibold text-current">
          {match[6] ?? match[7] ?? ""}
        </strong>,
      );
    } else if (match[8]) {
      nodes.push(
        <em key={`${keyPrefix}-em-${matchIndex}`} className="italic text-current">
          {match[9] ?? match[10] ?? ""}
        </em>,
      );
    }

    cursor = matchStart + fullMatch.length;
    matchIndex += 1;
  }

  if (cursor < content.length) {
    nodes.push(
      <span key={`${keyPrefix}-text-tail`}>{content.slice(cursor)}</span>,
    );
  }

  return nodes.length > 0 ? nodes : [<span key={`${keyPrefix}-text-full`}>{content}</span>];
}

function renderLightweightLine(line: string, lineIndex: number): ReactNode {
  if (line.length === 0) {
    return <div key={`line-${lineIndex}`} className="h-[0.8rem]" aria-hidden="true" />;
  }

  const headingMatch = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
  if (headingMatch) {
    const level = Math.min(headingMatch[1]?.length ?? 1, 6);
    const headingClass =
      level <= 2
        ? "text-lg font-semibold tracking-tight text-current"
        : "text-base font-semibold text-current";
    return (
      <div key={`line-${lineIndex}`} className={headingClass}>
        {renderLightweightInlineMarkdown(headingMatch[2] ?? "", `line-${lineIndex}`)}
      </div>
    );
  }

  const unorderedListMatch = /^ {0,3}[-+*]\s+(.*)$/.exec(line);
  if (unorderedListMatch) {
    return (
      <div key={`line-${lineIndex}`} className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-[0.15rem] text-muted-foreground">•</span>
        <span className="min-w-0">
          {renderLightweightInlineMarkdown(unorderedListMatch[1] ?? "", `line-${lineIndex}`)}
        </span>
      </div>
    );
  }

  const orderedListMatch = /^ {0,3}(\d+[.)])\s+(.*)$/.exec(line);
  if (orderedListMatch) {
    return (
      <div key={`line-${lineIndex}`} className="flex items-start gap-2">
        <span className="mt-[0.05rem] shrink-0 text-muted-foreground">{orderedListMatch[1]}</span>
        <span className="min-w-0">
          {renderLightweightInlineMarkdown(orderedListMatch[2] ?? "", `line-${lineIndex}`)}
        </span>
      </div>
    );
  }

  const blockquoteMatch = /^ {0,3}>\s?(.*)$/.exec(line);
  if (blockquoteMatch) {
    return (
      <div key={`line-${lineIndex}`} className="border-l-2 border-border-strong pl-3 text-muted-foreground">
        {renderLightweightInlineMarkdown(blockquoteMatch[1] ?? "", `line-${lineIndex}`)}
      </div>
    );
  }

  return (
    <div key={`line-${lineIndex}`} className="whitespace-pre-wrap">
      {renderLightweightInlineMarkdown(line, `line-${lineIndex}`)}
    </div>
  );
}

function renderLightweightTail(content: string, className?: string): ReactNode {
  if (!content.length) return null;

  const lines = content.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const fenceMatch = /^(\s*)```(\w*)/.exec(line);
      const indent = fenceMatch?.[1] ?? "";
      const language = fenceMatch?.[2] || "text";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        if (lines[i]?.startsWith(indent + "```")) {
          i += 1;
          break;
        }
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      elements.push(
        <div
          key={`code-${i}`}
          className="relative my-4 overflow-hidden rounded-xl border border-border-strong bg-secondary not-prose shadow-card"
        >
          <div className="flex items-center justify-between border-b border-border-strong bg-muted px-4 py-1.5 font-mono text-[length:var(--md-code-font-size,var(--text-sm))] text-muted-foreground">
            <span>{language}</span>
          </div>
          <pre className="p-4 overflow-x-auto text-[length:var(--md-code-font-size,var(--text-sm))] font-mono bg-transparent m-0 border-none">
            {codeLines.join("\n")}
          </pre>
        </div>,
      );
      continue;
    }

    // Table
    const tableLines: string[] = [];
    let j = i;
    while (j < lines.length && /^\s*\|/.test(lines[j] ?? "")) {
      tableLines.push(lines[j] ?? "");
      j += 1;
    }
    if (tableLines.length >= 2) {
      const separatorRow = tableLines[1] ?? "";
      const isSeparator = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(separatorRow);
      if (isSeparator) {
        const headerCells = (tableLines[0] ?? "")
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        const bodyRows = tableLines.slice(2);
        elements.push(
          <div key={`table-${i}`} className="overflow-x-auto my-6 not-prose">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  {headerCells.map((cell, ci) => (
                    <th
                      key={ci}
                      className="border border-border bg-muted px-3 py-1.5 text-left font-medium"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => {
                  const cells = row
                    .split("|")
                    .map((c) => c.trim())
                    .filter((c) => c.length > 0);
                  return (
                    <tr key={ri}>
                      {cells.map((cell, ci) => (
                        <td
                          key={ci}
                          className="border border-border px-3 py-1.5"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>,
        );
        i = j;
        continue;
      }
    }

    elements.push(renderLightweightLine(line, i));
    i += 1;
  }

  return (
    <div
      className={cn(
        "markdown-streaming-tail break-words leading-[1.5]",
        className,
      )}
    >
      <div className="space-y-2">{elements}</div>
    </div>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  isStreaming,
  compactCode = false,
  mode,
}: MarkdownRendererProps) {
  const renderMode = mode ?? getMarkdownRenderStrategy(isStreaming);
  const markdownVars = compactCode
    ? ({ "--md-code-font-size": "var(--text-xs)" } as CSSProperties)
    : undefined;

  // Memoize tail rendering to avoid re-computing on every character
  const lightweightTail = useMemo(() => {
    if (renderMode === "streaming-light") {
      return renderLightweightTail(content);
    }
    return null;
  }, [content, renderMode]);

  const { stableContent, tailContent } = useMemo(() =>
    renderMode === "streaming-hybrid"
      ? splitStreamingMarkdown(content)
      : { stableContent: content, tailContent: "" },
    [content, renderMode]
  );

  const hybridTail = useMemo(() => {
    if (renderMode === "streaming-hybrid" && tailContent) {
      return renderLightweightTail(tailContent, stableContent ? "mt-[0.8rem]" : undefined);
    }
    return null;
  }, [tailContent, stableContent, renderMode]);

  if (renderMode === "streaming-light") {
    return (
      <div
        style={markdownVars}
        className={cn(
          "markdown-body conversation-markdown font-sans max-w-none break-words",
          isStreaming && "streaming-active",
          className,
        )}
      >
        {lightweightTail}
      </div>
    );
  }



  return (
    <div
      style={markdownVars}
      className={cn(
        "markdown-body conversation-markdown font-sans prose prose-sm dark:prose-invert max-w-none break-words prose-pre:p-0",
        "prose-p:text-current prose-headings:text-current prose-li:text-current prose-strong:text-current prose-li:marker:text-current",
        isStreaming && "streaming-active",
        className
      )}
    >
      {stableContent ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
          components={components}
        >
          {stableContent}
        </ReactMarkdown>
      ) : null}
      {hybridTail}
    </div>
  );
});
