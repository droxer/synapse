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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import { MarkdownRenderer } from "@/shared/components";
import { TerminalWindow, stripAnsi } from "@/shared/components/ui/terminal-window";
import { WebLinks, type WebLink } from "@/shared/components/ui/web-links";
import { ImageOutput } from "@/shared/components/ui/image-output";
import { HtmlOutput } from "@/shared/components/ui/html-output";
import { CodeOutput } from "@/shared/components/ui/code-output";
import { ExpandToggle } from "@/shared/components/ui/expand-toggle";
import { BrowserOutput } from "./BrowserOutput";
import { ComputerUseOutput } from "./ComputerUseOutput";
import {
  PROSE_CLASSES,
  TOOL_OUTPUT_MARKDOWN_CLASSES,
  OUTPUT_CARD_BASE_CLASSES,
  OUTPUT_HEADER_LABEL_CLASSES,
  OUTPUT_HEADER_ROW_CLASSES,
  OUTPUT_META_TEXT_CLASSES,
} from "../lib/format-tools";
import { CODE_TOOLS } from "../lib/tool-constants";
import { getToolCategory, type ToolCategory } from "../lib/tool-constants";
import type { BrowserMetadata, ComputerUseMetadata } from "@/shared/types";

/** Max chars to show before collapsing */
const COLLAPSE_THRESHOLD = 500;
const ELLIPSIS = "…";

interface CategoryStyle {
  readonly border: string;
  readonly icon: LucideIcon;
  readonly labelKey: string;
}

const CATEGORY_STYLES: Record<ToolCategory, CategoryStyle> = {
  code:    { border: "border-l-border-strong", icon: Terminal,  labelKey: "output.category.code" },
  file:    { border: "border-l-border-strong", icon: FileCode,  labelKey: "output.category.file" },
  search:  { border: "border-l-border-strong", icon: Globe,     labelKey: "output.category.search" },
  memory:   { border: "border-l-border-strong", icon: Database,  labelKey: "output.category.memory" },
  browser:  { border: "border-l-border-strong", icon: Monitor,   labelKey: "output.category.browser" },
  computer: { border: "border-l-border-strong", icon: Monitor,   labelKey: "output.category.computer" },
  preview: { border: "border-l-border-strong", icon: Play,      labelKey: "output.category.preview" },
  mcp:      { border: "border-l-border-strong", icon: Plug,      labelKey: "output.category.mcp" },
  agent:    { border: "border-l-border-strong", icon: GitFork,   labelKey: "output.category.agent" },
  database: { border: "border-l-border-strong", icon: Database,  labelKey: "output.category.database" },
  default:  { border: "border-l-border",            icon: FileText,  labelKey: "" },
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
  const resolvedOutput = toolName === "task_complete" ? t("output.taskMarkedComplete") : output;
  const isLong = resolvedOutput.length > COLLAPSE_THRESHOLD;
  const isCode = CODE_TOOLS.has(toolName) || contentType?.startsWith("text/x-") || contentType?.startsWith("text/javascript");
  const isImage = contentType?.startsWith("image/");
  const isHtml = contentType === "text/html";

  const category = getToolCategory(toolName);
  const style = CATEGORY_STYLES[category];
  const CategoryIcon = style.icon;

  const handleToggle = useCallback(() => setExpanded((p) => !p), []);

  const displayText = isLong && !expanded ? resolvedOutput.slice(0, COLLAPSE_THRESHOLD) : resolvedOutput;

  // Image artifact rendering
  if (isImage) {
    return (
      <ImageOutput
        output={output}
        conversationId={conversationId}
        artifactIds={artifactIds}
        className="mt-2.5"
      />
    );
  }

  // HTML content rendering
  if (isHtml) {
    return <HtmlOutput output={output} className="mt-2.5" />;
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
          className="mt-2.5"
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
      <TerminalWindow title={`preview${portLabel ? ` \u2014 ${portLabel}` : ""}`} className="mt-2.5">
        {/* Command line */}
        <div className="flex gap-2">
          <span className="text-[var(--color-terminal-text)]">$</span>
          <span className="text-[var(--color-terminal-text)]">{t("output.preview.serverStart")}</span>
        </div>

        {/* Output */}
        <pre className="mt-2 whitespace-pre-wrap text-[var(--color-terminal-text)]">{stripAnsi(output)}</pre>

        {/* Status indicator */}
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-terminal-border)] pt-3">
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

  // Shell exec — terminal-style renderer
  if (toolName === "shell_exec") {
    return (
      <TerminalWindow title={t("output.shell.title")} className="mt-2.5" copyText={stripAnsi(output)}>
        {/* Output */}
        <pre className="whitespace-pre-wrap text-[var(--color-terminal-text)]">
          {stripAnsi(displayText)}
          {isLong && !expanded && (
            <span className="text-[var(--color-terminal-dim)]">{`\n${ELLIPSIS}`}</span>
          )}
        </pre>

        {isLong && (
          <div className="mt-2 border-t border-[var(--color-terminal-border)] pt-2">
            <ExpandToggle expanded={expanded} onToggle={handleToggle} />
          </div>
        )}
      </TerminalWindow>
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
        className="mt-2.5"
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
          <div className="space-y-1">
            {entries.map(([agentId, result]) => (
              <div key={agentId} className="flex items-start gap-2 rounded px-2 py-1 text-sm text-muted-foreground">
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
            <div className="space-y-1.5">
              {messages.map((msg, i) => (
                <div key={i} className="rounded border border-border bg-background px-2.5 py-1.5 text-sm">
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
          const MAX_ROWS = 20;
          const visibleRows = rows.slice(0, MAX_ROWS);
          const remaining = rows.length - MAX_ROWS;
          return (
            <div className={OUTPUT_CARD_BASE_CLASSES}>
              <div className={cn(OUTPUT_HEADER_ROW_CLASSES, "gap-1")}>
                <Database className="h-3 w-3" />
                <span className={OUTPUT_HEADER_LABEL_CLASSES}>{summaryLine}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {columns.map((col) => (
                        <th key={col} className="whitespace-nowrap px-2 py-1 text-micro font-medium text-muted-foreground-dim">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => (
                      <tr key={i} className={cn("border-b border-border", i % 2 === 1 && "bg-background")}>
                        {columns.map((col) => (
                          <td key={col} className="px-2 py-1 text-muted-foreground break-words">{String(row[col] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {remaining > 0 && (
                <div className={cn("mt-1.5", OUTPUT_META_TEXT_CLASSES)}>
                  {t("output.dbQueryMore", { count: remaining })}
                </div>
              )}
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
            <div className="space-y-0.5">
              {entries.map((entry, i) => {
                const label = entry.namespace ? `${entry.namespace}:${entry.key}` : entry.key;
                const value = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
                return (
                  <div key={i} className="flex gap-2 px-2 py-0.5 text-sm">
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
      <div className="mt-2.5 rounded-md border-l-2 border-l-destructive bg-destructive/5 px-2.5 py-1.5">
        <div className="mb-1.5 flex items-center gap-1 text-sm font-medium text-destructive">
          <CircleX className="h-3 w-3" />
          {t("output.toolFailed")}
        </div>
        <div className={PROSE_CLASSES}>
          <MarkdownRenderer content={displayText} className={TOOL_OUTPUT_MARKDOWN_CLASSES} />
          {isLong && !expanded && (
            <span className="text-muted-foreground-dim">{ELLIPSIS}</span>
          )}
        </div>
        {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
        <p className="mt-1 text-xs text-muted-foreground">{t("conversation.retry")}</p>
      </div>
    );
  }

  // Category-aware rendering for all other tools (markdown fallback)
  return (
    <div className={cn("mt-2.5 rounded-md border-l-2 bg-muted px-2.5 py-1.5", style.border)}>
      <div className="mb-1.5 flex items-center justify-end">
        {style.labelKey && (
          <span className="flex items-center gap-1 text-micro font-medium text-muted-foreground-dim">
            <CategoryIcon className="h-3 w-3" />
            {t(style.labelKey)}
          </span>
        )}
      </div>

      <div className={PROSE_CLASSES}>
        <MarkdownRenderer content={displayText} className={TOOL_OUTPUT_MARKDOWN_CLASSES} />
        {isLong && !expanded && (
          <span className="text-muted-foreground-dim">{ELLIPSIS}</span>
        )}
      </div>

      {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
    </div>
  );
}
