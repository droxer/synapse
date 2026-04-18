"use client";

import { useState, useCallback } from "react";
import {
  Terminal,
  Globe,
  Database,
  Monitor,
  FileText,
  FileCode,
  Play,
  Plug,
  GitFork,
  CircleCheck,
  CircleX,
  MessageSquare,
  Braces,
  Copy,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { TerminalWindow, stripAnsi } from "@/shared/components/ui/terminal-window";
import { WebLinks, type WebLink } from "@/shared/components/ui/web-links";
import { ImageOutput } from "@/shared/components/ui/image-output";
import { HtmlOutput } from "@/shared/components/ui/html-output";
import { CodeOutput } from "@/shared/components/ui/code-output";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import {
  OUTPUT_SURFACE_FOCUS_CLASSES,
  OutputSurface,
  OutputSurfaceBody,
  OutputSurfaceHeader,
  OutputSurfaceInner,
} from "@/shared/components/ui/output-surface";
import { BrowserOutput } from "./BrowserOutput";
import { ComputerUseOutput } from "./ComputerUseOutput";
import {
  PROSE_CLASSES,
  TOOL_OUTPUT_MARKDOWN_CLASSES,
  OUTPUT_CARD_BASE_CLASSES,
  OUTPUT_CARD_BODY_CLASSES,
  OUTPUT_CARD_INNER_CLASSES,
  OUTPUT_HEADER_LABEL_CLASSES,
  OUTPUT_HEADER_ROW_CLASSES,
  OUTPUT_COLLAPSE_THRESHOLD,
} from "../lib/format-tools";
import { CODE_TOOLS } from "../lib/tool-constants";
import { getToolCategory, type ToolCategory } from "../lib/tool-constants";
import type { BrowserMetadata, ComputerUseMetadata } from "@/shared/types";

const ELLIPSIS = "…";

interface CategoryStyle {
  readonly icon: LucideIcon;
  readonly labelKey: string;
}

const CATEGORY_STYLES: Record<ToolCategory, CategoryStyle> = {
  code: { icon: Terminal, labelKey: "output.category.code" },
  file: { icon: FileCode, labelKey: "output.category.file" },
  search: { icon: Globe, labelKey: "output.category.search" },
  memory: { icon: Database, labelKey: "output.category.memory" },
  browser: { icon: Globe, labelKey: "output.category.browser" },
  computer: { icon: Monitor, labelKey: "output.category.computer" },
  preview: { icon: Play, labelKey: "output.category.preview" },
  mcp: { icon: Plug, labelKey: "output.category.mcp" },
  agent: { icon: GitFork, labelKey: "output.category.agent" },
  database: { icon: Database, labelKey: "output.category.database" },
  default: { icon: FileText, labelKey: "" },
};

interface SearchPayload {
  readonly query: string;
  readonly results: readonly WebLink[];
}

function tryParseSearchResults(output: string): SearchPayload | null {
  try {
    const parsed = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.query === "string" &&
      Array.isArray(parsed.results)
    ) {
      return parsed as SearchPayload;
    }
  } catch {
    // Not valid JSON — fall through
  }
  return null;
}

interface PreviewInfo {
  readonly port: string | null;
  readonly directory: string | null;
}

function parsePreviewOutput(output: string): PreviewInfo {
  const portMatch = output.match(/port\s+(\d+)/i);
  const dirMatch = output.match(/serving\s+(\/\S+)/i);
  return {
    port: portMatch ? portMatch[1] : null,
    directory: dirMatch ? dirMatch[1] : null,
  };
}

/** Map MIME content types to highlight.js language identifiers. */
function contentTypeToLang(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  const map: Record<string, string> = {
    "text/x-python": "python",
    "text/javascript": "javascript",
    "text/x-java": "java",
    "text/x-c": "c",
    "text/x-cpp": "cpp",
    "text/x-ruby": "ruby",
    "text/x-go": "go",
    "text/x-rust": "rust",
    "text/x-typescript": "typescript",
    "text/x-swift": "swift",
    "text/x-kotlin": "kotlin",
    "text/x-sql": "sql",
    "text/x-shellscript": "bash",
    "text/x-sh": "bash",
    "text/css": "css",
    "text/html": "html",
    "text/xml": "xml",
    "application/json": "json",
    "application/xml": "xml",
    "application/javascript": "javascript",
  };
  return map[contentType];
}

interface ToolOutputRendererProps {
  readonly output: string;
  readonly toolName: string;
  readonly success?: boolean;
  readonly contentType?: string;
  readonly conversationId?: string | null;
  readonly artifactIds?: string[];
  readonly browserMetadata?: BrowserMetadata;
  readonly computerUseMetadata?: ComputerUseMetadata;
  readonly agentNameMap?: ReadonlyMap<string, string>;
}

export function ToolOutputRenderer({ output, toolName, success, contentType, conversationId, artifactIds, browserMetadata, computerUseMetadata, agentNameMap }: ToolOutputRendererProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const resolvedOutput = toolName === "task_complete" ? t("output.taskMarkedComplete") : output;
  const isLong = resolvedOutput.length > OUTPUT_COLLAPSE_THRESHOLD;
  const isCode = CODE_TOOLS.has(toolName) || contentType?.startsWith("text/x-") || contentType?.startsWith("text/javascript");
  const isImage = contentType?.startsWith("image/");
  const isHtml = contentType === "text/html";

  const category = getToolCategory(toolName);
  const style = CATEGORY_STYLES[category];
  const CategoryIcon = style.icon;

  const handleToggle = useCallback(() => setExpanded((p) => !p), []);
  const handleJsonCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      // Clipboard denied — ignore
    }
  }, []);

  const displayText = isLong && !expanded ? resolvedOutput.slice(0, OUTPUT_COLLAPSE_THRESHOLD) : resolvedOutput;

  // Image artifact rendering
  if (isImage) {
    return (
      <ImageOutput
        output={output}
        conversationId={conversationId}
        artifactIds={artifactIds}
        className="mt-2"
      />
    );
  }

  // HTML content rendering
  if (isHtml) {
    return <HtmlOutput output={output} className="mt-2" />;
  }

  // Web search results — show clean clickable links
  if (category === "search" && toolName === "web_search") {
    const searchData = tryParseSearchResults(output);
    if (searchData) {
      return (
        <WebLinks
          query={searchData.query}
          results={searchData.results}
          resultsLabel={t(
            searchData.results.length === 1 ? "output.searchResult" : "output.searchResults",
            { count: searchData.results.length },
          )}
          searchLabel={t("output.searchLabel")}
          className="mt-2"
        />
      );
    }
  }

  // Preview tool — terminal-style renderer
  if (category === "preview") {
    const preview = parsePreviewOutput(output);
    const isActive = toolName === "preview_start";
    const portLabel = preview.port ? `:${preview.port}` : "";

    return (
      <TerminalWindow title={`preview${portLabel ? ` \u2014 ${portLabel}` : ""}`} className="mt-2">
        {/* Command line */}
        <div className="flex gap-2">
          <span className="text-[var(--color-terminal-text)]">$</span>
          <span className="text-[var(--color-terminal-text)]">{t("output.preview.serverStart")}</span>
        </div>

        {/* Output */}
        <div className="mt-2 overflow-x-auto">
          <pre className="whitespace-pre text-[var(--color-terminal-text)]">{stripAnsi(output)}</pre>
        </div>

        {/* Status indicator */}
        <div className="mt-3 flex items-center gap-2 border-t border-terminal-border pt-3">
          {isActive ? (
            <>
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-text)]" />
              <span className="text-[var(--color-terminal-text)]">
                {t("output.preview.listening", { port: preview.port ?? "..." })}
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-terminal-dim)]" />
              <span className="text-[var(--color-terminal-dim)]">{t("output.preview.stopped")}</span>
            </>
          )}
        </div>
      </TerminalWindow>
    );
  }

  // Shell/code execution — terminal-style renderer
  if (toolName === "shell_exec" || toolName === "code_run") {
    return (
      <TerminalWindow title={t("output.shell.title")} className="mt-2" copyText={stripAnsi(output)}>
        {/* Output */}
        <div className="overflow-x-auto">
          <pre className="whitespace-pre text-[var(--color-terminal-text)]">
            {stripAnsi(displayText)}
            {isLong && !expanded && (
              <span className="text-[var(--color-terminal-dim)]">{`\n${ELLIPSIS}`}</span>
            )}
          </pre>
        </div>

        {isLong && (
          <div className="mt-2 border-t border-terminal-border pt-2">
            <ExpandToggle expanded={expanded} onToggle={handleToggle} />
          </div>
        )}
      </TerminalWindow>
    );
  }

  const parsedJson = (() => {
    if (
      contentType === "application/json" ||
      resolvedOutput.startsWith("{") ||
      resolvedOutput.startsWith("[")
    ) {
      try {
        return JSON.parse(resolvedOutput);
      } catch {
        return null;
      }
    }
    return null;
  })();

  if (parsedJson && category !== "search" && toolName !== "database_query" && toolName !== "agent_wait" && toolName !== "agent_receive" && !(category === "memory" && (toolName === "memory_search" || toolName === "memory_list"))) {
    const prettyJson = JSON.stringify(parsedJson, null, 2);
    const isLongJson = prettyJson.length > OUTPUT_COLLAPSE_THRESHOLD;
    const displayJson = isLongJson && !expanded ? prettyJson.slice(0, OUTPUT_COLLAPSE_THRESHOLD) : prettyJson;
    return (
      <OutputSurface>
        <OutputSurfaceHeader
          icon={<Braces className="h-3.5 w-3.5 text-muted-foreground" />}
          label={style.labelKey ? t(style.labelKey) : "Structured output"}
          className="justify-between"
          action={(
            <button
              type="button"
              onClick={() => handleJsonCopy(prettyJson)}
              aria-label={copiedJson ? t("output.copied") : t("output.copyToClipboard")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                OUTPUT_SURFACE_FOCUS_CLASSES,
              )}
            >
              {copiedJson ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedJson ? t("output.copied") : t("output.copy")}
            </button>
          )}
        />
        <OutputSurfaceBody>
          <OutputSurfaceInner className="overflow-x-auto">
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-muted-foreground">
              {displayJson}
              {isLongJson && !expanded && ELLIPSIS}
            </pre>
          </OutputSurfaceInner>
          {isLongJson && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
        </OutputSurfaceBody>
      </OutputSurface>
    );
  }

  // Code output
  if (isCode) {
    return (
      <CodeOutput
        output={output}
        icon={style.icon}
        label={style.labelKey ? t(style.labelKey) : ""}
        language={contentTypeToLang(contentType)}
        className="mt-2"
      />
    );
  }

  // Computer use — dedicated rich renderer
  if (category === "computer" && (toolName === "computer_action" || toolName === "computer_screenshot")) {
    return (
      <ComputerUseOutput
        output={output}
        computerUseMetadata={computerUseMetadata}
        toolName={toolName}
        conversationId={conversationId}
        artifactIds={artifactIds}
      />
    );
  }

  // Browser use — dedicated rich renderer
  if (category === "browser" && toolName === "browser_use") {
    return (
      <BrowserOutput
        output={output}
        browserMetadata={browserMetadata}
        conversationId={conversationId}
        artifactIds={artifactIds}
      />
    );
  }

  // agent_wait — Agent Results Card
  if (toolName === "agent_wait") {
    try {
      const results = JSON.parse(output) as Record<string, { success: boolean; summary: string; error: string | null; artifacts: string[] }>;
      const entries = Object.entries(results);
        return (
          <div className={OUTPUT_CARD_BASE_CLASSES}>
            <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "gap-1")}>
              <GitFork className="h-3 w-3" />
              <span className={OUTPUT_HEADER_LABEL_CLASSES}>{t("output.agentResults")}</span>
            </div>
            <div className={cn(OUTPUT_CARD_BODY_CLASSES, "space-y-1")}>
              {entries.map(([agentId, result]) => (
                <div key={agentId} className={cn(OUTPUT_CARD_INNER_CLASSES, "flex items-start gap-2.5 py-1.5 text-sm text-muted-foreground")}>
                  {result.success ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className="shrink-0 font-mono text-micro text-muted-foreground-dim">{agentNameMap?.get(agentId) || agentId.slice(0, 8)}</span>
                  <span className="min-w-0 break-words">{result.error ?? result.summary}</span>
                </div>
              ))}
            </div>
          </div>
        );
    } catch {
      // Fall through to generic renderer
    }
  }

  // agent_receive — Message List
  if (toolName === "agent_receive") {
    if (output === "No pending messages." || output === "[]") {
      return (
        <div className={OUTPUT_CARD_BASE_CLASSES}>
          <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "gap-1")}>
            <MessageSquare className="h-3 w-3" />
            <span className={OUTPUT_HEADER_LABEL_CLASSES}>{t("output.noMessages")}</span>
          </div>
        </div>
      );
    }
    try {
      const messages = JSON.parse(output) as Array<{ from: string; to: string; message: string; metadata?: object }>;
      if (Array.isArray(messages)) {
        return (
          <div className={OUTPUT_CARD_BASE_CLASSES}>
            <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "gap-1")}>
              <MessageSquare className="h-3 w-3" />
              <span className={OUTPUT_HEADER_LABEL_CLASSES}>{t("output.agentMessages", { count: messages.length })}</span>
            </div>
            <div className={cn(OUTPUT_CARD_BODY_CLASSES, "space-y-1.5")}>
              {messages.map((msg, i) => (
                <div key={i} className={cn(OUTPUT_CARD_INNER_CLASSES, "text-sm")}>
                  <div className="mb-0.5 text-micro text-muted-foreground-dim">
                    {t("output.agentMessageFrom", { id: agentNameMap?.get(msg.from) || msg.from.slice(0, 12) })}
                  </div>
                  <div className="min-w-0 break-words text-muted-foreground">{msg.message}</div>
                </div>
              ))}
            </div>
          </div>
        );
      }
    } catch {
      // Fall through to generic renderer
    }
  }

  // database_query (SELECT) — Table View
  if (toolName === "database_query") {
    const newlineIdx = output.indexOf("\n");
    if (newlineIdx > 0) {
      const summaryLine = output.slice(0, newlineIdx);
      const jsonPart = output.slice(newlineIdx + 1);
      try {
        const rows = JSON.parse(jsonPart) as Record<string, unknown>[];
        if (Array.isArray(rows) && rows.length > 0) {
          const columns = Object.keys(rows[0]);
          return (
            <div className={OUTPUT_CARD_BASE_CLASSES}>
              <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "gap-1")}>
                <Database className="h-3 w-3" />
                <span className={OUTPUT_HEADER_LABEL_CLASSES}>{summaryLine}</span>
              </div>
              <div className={OUTPUT_CARD_BODY_CLASSES}>
              <div className={cn(OUTPUT_CARD_INNER_CLASSES, "overflow-x-auto")}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {columns.map((col) => (
                        <th key={col} className="whitespace-nowrap px-2 py-1 text-micro font-medium text-muted-foreground-dim">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={cn("border-b border-border", i % 2 === 1 && "bg-background")}>
                        {columns.map((col) => (
                          <td key={col} className="px-2 py-1 text-muted-foreground break-words">{String(row[col] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          );
        }
      } catch {
        // Fall through to generic renderer
      }
    }
  }

  // memory_search / memory_list — Memory Entry Cards
  if (category === "memory" && (toolName === "memory_search" || toolName === "memory_list")) {
    try {
      const parsed = JSON.parse(output);
      const entries: Array<{ key: string; value: string; namespace?: string }> = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([k, v]) => ({ key: k, value: String(v) }));
      if (entries.length > 0) {
        return (
          <div className={OUTPUT_CARD_BASE_CLASSES}>
            <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "gap-1")}>
              <Database className="h-3 w-3" />
              <span className={OUTPUT_HEADER_LABEL_CLASSES}>{t("output.memoryEntries", { count: entries.length })}</span>
            </div>
            <div className={cn(OUTPUT_CARD_BODY_CLASSES, "space-y-1")}>
              {entries.map((entry, i) => {
                const label = entry.namespace ? `${entry.namespace}:${entry.key}` : entry.key;
                const value = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
                return (
                  <div key={i} className={cn(OUTPUT_CARD_INNER_CLASSES, "flex gap-2 py-1 text-sm")}>
                    <span className="shrink-0 font-mono text-micro text-muted-foreground-dim">{label}</span>
                    <span className="min-w-0 break-words text-muted-foreground">{value.length > 80 ? `${value.slice(0, 80)}${ELLIPSIS}` : value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
    } catch {
      // Fall through to generic renderer
    }
  }

  // Failed tool call — show error output with distinct styling
  if (success === false) {
    return (
      <div className={cn(OUTPUT_CARD_BASE_CLASSES, "border-destructive bg-destructive/5")}>
        <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "border-destructive/30 text-destructive")}>
          <CircleX className="h-3 w-3" />
          {t("output.toolFailed")}
        </div>
        <div className={OUTPUT_CARD_BODY_CLASSES}>
          <div className={cn(OUTPUT_CARD_INNER_CLASSES, PROSE_CLASSES, "border-destructive/30 bg-card")}>
            <MarkdownRenderer content={displayText} className={TOOL_OUTPUT_MARKDOWN_CLASSES} compactCode />
            {isLong && !expanded && (
              <span className="text-muted-foreground-dim">{ELLIPSIS}</span>
            )}
          </div>
          {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
          <p className="mt-1 text-xs text-muted-foreground">{t("conversation.retry")}</p>
        </div>
      </div>
    );
  }

  // Category-aware rendering for all other tools (markdown fallback)
  return (
    <OutputSurface>
      {style.labelKey && (
        <OutputSurfaceHeader
          icon={<CategoryIcon className="h-3 w-3 text-muted-foreground" />}
          label={t(style.labelKey)}
        />
      )}

      <OutputSurfaceBody>
        <OutputSurfaceInner className={PROSE_CLASSES}>
          <MarkdownRenderer content={displayText} className={TOOL_OUTPUT_MARKDOWN_CLASSES} compactCode />
          {isLong && !expanded && (
            <span className="text-muted-foreground-dim">{ELLIPSIS}</span>
          )}
        </OutputSurfaceInner>
        {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
      </OutputSurfaceBody>
    </OutputSurface>
  );
}
