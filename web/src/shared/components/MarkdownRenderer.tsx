"use client";

import { memo, useState, useCallback, useEffect, useRef, isValidElement, type ReactNode } from "react";
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
      onClick={handleCopy}
      className="flex items-center gap-1 hover:text-foreground transition-colors p-1"
      aria-label="Copy code"
      title="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
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
      <div className="relative my-4 rounded-lg border bg-muted/50 overflow-hidden not-prose">
        <div className="flex items-center justify-between px-4 py-1.5 border-b bg-muted text-sm text-muted-foreground font-mono">
          <span>{language}</span>
          <CopyButton text={codeString} />
        </div>
        <pre className="p-4 overflow-x-auto text-sm font-mono bg-transparent m-0 border-none">
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
          className="rounded-md border border-border/70 bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground"
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
        className="text-primary underline underline-offset-2 hover:text-primary/80"
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
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  isStreaming,
}: MarkdownRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const firstParagraph = root.querySelector("p");
    const firstPre = root.querySelector("pre");
    const firstInlineCode = root.querySelector("p code");
    const firstCodeBlockCode = root.querySelector("pre code");
    const firstCodeHeader = root.querySelector("div.not-prose > div");
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
    fetch("http://127.0.0.1:7800/ingest/f3cbd1e5-6b99-4559-90b9-9eaeb44e6deb", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "157ac9" }, body: JSON.stringify({ sessionId: "157ac9", runId: "initial", hypothesisId: "H1", location: "MarkdownRenderer.tsx:render-metrics", message: "Captured markdown typography metrics", data: { rootClassName: root.className, extraClassName: className ?? "", paragraph: getMetrics(firstParagraph), pre: getMetrics(firstPre), inlineCode: getMetrics(firstInlineCode), codeBlockCode: getMetrics(firstCodeBlockCode), codeHeader: getMetrics(firstCodeHeader), isStreaming: Boolean(isStreaming) }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
  }, [className, content, isStreaming]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "markdown-body font-sans prose prose-sm dark:prose-invert max-w-none break-words prose-p:leading-relaxed prose-pre:p-0",
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
