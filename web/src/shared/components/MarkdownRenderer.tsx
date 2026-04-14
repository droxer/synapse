"use client";

import { memo, useState, useCallback, isValidElement, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import { Copy, Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label="Copy code"
      title="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-accent-emerald" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="sr-only">Copy</span>
    </button>
  );
}

const components: Components = {
  pre({ children }) {
    let language = "text";

    if (isValidElement<{ className?: string }>(children)) {
      const className = children.props.className;
      const match = /language-(\w+)/.exec(className ?? "");
      if (match) {
        language = match[1];
      }
    }

    const codeString = extractText(children);

    return (
      <div className="relative my-4 overflow-hidden rounded-xl border border-border-strong bg-secondary/50 not-prose shadow-card">
        <div className="flex items-center justify-between border-b border-border-strong bg-muted px-4 py-1.5 font-mono text-[length:var(--md-code-font-size,var(--text-sm))] text-muted-foreground">
          <span>{language}</span>
          <CopyButton text={codeString} />
        </div>
        <pre className="p-4 overflow-x-auto text-[length:var(--md-code-font-size,var(--text-sm))] font-mono bg-transparent m-0 border-none">
          {children}
        </pre>
      </div>
    );
  },
  code({ className, children, ...props }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded-lg border border-border-strong bg-muted/65 px-1.5 py-0.5 text-[length:var(--md-code-font-size,var(--text-sm))] font-mono text-foreground"
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
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-focus underline underline-offset-2 hover:text-focus/80"
      >
        {children}
      </a>
    );
  },
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  compactCode?: boolean;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  isStreaming,
  compactCode = false,
}: MarkdownRendererProps) {
  const markdownVars = compactCode
    ? ({ "--md-code-font-size": "var(--text-xs)" } as CSSProperties)
    : undefined;

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
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
