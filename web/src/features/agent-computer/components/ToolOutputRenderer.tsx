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
import { CODE_TOOLS } from "../lib/tool-constants";
import { getToolCategory, type ToolCategory } from "../lib/tool-constants";

/** Max chars to show before collapsing */
const COLLAPSE_THRESHOLD = 500;

interface CategoryStyle {
  readonly border: string;
  readonly icon: LucideIcon;
  readonly labelKey: string;
}

const CATEGORY_STYLES: Record<ToolCategory, CategoryStyle> = {
  code:    { border: "border-l-accent-emerald/60", icon: Terminal,  labelKey: "output.category.code" },
  file:    { border: "border-l-user-accent/60",    icon: FileCode,  labelKey: "output.category.file" },
  search:  { border: "border-l-accent-purple/60",  icon: Globe,     labelKey: "output.category.search" },
  memory:  { border: "border-l-accent-amber/60",   icon: Database,  labelKey: "output.category.memory" },
  browser: { border: "border-l-ai-glow/60",        icon: Monitor,   labelKey: "output.category.browser" },
  preview: { border: "border-l-accent-emerald/60", icon: Play,      labelKey: "output.category.preview" },
  default: { border: "border-l-border",            icon: FileText,  labelKey: "" },
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

interface ToolOutputRendererProps {
  readonly output: string;
  readonly toolName: string;
  readonly contentType?: string;
  readonly conversationId?: string | null;
  readonly artifactIds?: string[];
}

export function ToolOutputRenderer({ output, toolName, contentType, conversationId, artifactIds }: ToolOutputRendererProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isLong = output.length > COLLAPSE_THRESHOLD;
  const isCode = CODE_TOOLS.has(toolName) || contentType?.startsWith("text/x-") || contentType?.startsWith("text/javascript");
  const isImage = contentType?.startsWith("image/");
  const isHtml = contentType === "text/html";

  const category = getToolCategory(toolName);
  const style = CATEGORY_STYLES[category];
  const CategoryIcon = style.icon;

  const handleToggle = useCallback(() => setExpanded((p) => !p), []);

  const displayText = isLong && !expanded ? output.slice(0, COLLAPSE_THRESHOLD) : output;

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
          <span className="text-accent-emerald">$</span>
          <span className="text-[var(--color-terminal-text)]">{t("output.preview.serverStart")}</span>
        </div>

        {/* Output */}
        <pre className="mt-2 whitespace-pre-wrap text-accent-emerald">{stripAnsi(output)}</pre>

        {/* Status indicator */}
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-terminal-border)] pt-3">
          {isActive ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-emerald opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-emerald" />
              </span>
              <span className="text-accent-emerald">
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
      <TerminalWindow title={t("output.shell.title")} className="mt-2.5">
        {/* Output */}
        <pre className="whitespace-pre-wrap text-[var(--color-terminal-text)]">
          {stripAnsi(displayText)}
          {isLong && !expanded && (
            <span className="text-[var(--color-terminal-dim)]">{"\n..."}</span>
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
        className="mt-2.5"
      />
    );
  }

  // Category-aware rendering for all other tools (markdown fallback)
  return (
    <div className={cn("mt-2.5 rounded-md border-l-2 bg-muted/60 px-3 py-2", style.border)}>
      <div className="mb-1.5 flex items-center justify-end">
        {style.labelKey && (
          <span className="flex items-center gap-1 text-micro text-muted-foreground-dim">
            <CategoryIcon className="h-3 w-3" />
            {t(style.labelKey)}
          </span>
        )}
      </div>

      <div className="prose-sm text-sm leading-relaxed text-muted-foreground [&_a]:text-user-accent [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:pl-4 [&_p]:my-1 [&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-sm [&_ul]:my-1 [&_ul]:pl-4">
        <MarkdownRenderer content={displayText} />
        {isLong && !expanded && (
          <span className="text-muted-foreground-dim">...</span>
        )}
      </div>

      {isLong && <ExpandToggle expanded={expanded} onToggle={handleToggle} />}
    </div>
  );
}
