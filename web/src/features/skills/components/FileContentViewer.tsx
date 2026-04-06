"use client";

import { useMemo } from "react";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { useTranslation } from "@/i18n";
import { getFileIcon } from "./FileTree";

interface FileContentViewerProps {
  readonly path: string;
  readonly content: string;
  readonly isLoading: boolean;
}

/** Map file extensions to markdown code fence language tags. */
const LANG_BY_EXT: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".toml": "toml",
  ".sql": "sql",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".lua": "lua",
  ".r": "r",
  ".R": "r",
};

function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function isMarkdown(path: string): boolean {
  return getExtension(path) === ".md";
}

function isSkillMd(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

function isCodeFile(path: string): boolean {
  const ext = getExtension(path);
  return ext in LANG_BY_EXT;
}

/** Split SKILL.md content into frontmatter YAML + body. */
function splitFrontmatter(content: string): { yaml: string; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx < 0) return null;

  const yaml = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();
  return { yaml, body };
}

export function FileContentViewer({
  path,
  content,
  isLoading,
}: FileContentViewerProps) {
  const { t: _t } = useTranslation();

  const rendered = useMemo(() => {
    if (isLoading) return null;

    // SKILL.md — show frontmatter as YAML code block + markdown body
    if (isSkillMd(path)) {
      const parts = splitFrontmatter(content);
      if (parts) {
        const combined = `\`\`\`yaml\n${parts.yaml}\n\`\`\`\n\n${parts.body}`;
        return <MarkdownRenderer content={combined} className="max-w-none break-words" />;
      }
      return <MarkdownRenderer content={content} className="max-w-none break-words" />;
    }

    // Regular markdown
    if (isMarkdown(path)) {
      return <MarkdownRenderer content={content} className="max-w-none break-words" />;
    }

    // Code files — render through MarkdownRenderer for syntax highlighting
    const ext = getExtension(path);
    const lang = LANG_BY_EXT[ext];
    if (lang) {
      const fenced = `\`\`\`${lang}\n${content}\n\`\`\``;
      return (
        <div className="file-viewer-code [&_.markdown-body]:bg-transparent [&_.markdown-body_pre]:m-0 [&_.markdown-body_pre]:rounded-none [&_.markdown-body_pre]:border-0 [&_.markdown-body_pre]:bg-transparent [&_.markdown-body_pre]:p-4">
          <MarkdownRenderer content={fenced} />
        </div>
      );
    }

    // Unknown — plain preformatted text
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
        {content}
      </pre>
    );
  }, [path, content, isLoading]);

  // Breadcrumb file icon
  const fileName = path.split("/").pop() ?? path;
  const FileIcon = getFileIcon(fileName);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        {/* Breadcrumb skeleton */}
        <div className="shrink-0 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-3.5 w-3.5 skeleton-shimmer rounded" />
            <div className="h-3.5 w-48 skeleton-shimmer rounded" />
          </div>
        </div>
        {/* Content skeleton */}
        <div className="flex flex-col gap-3 p-6">
          <div className="h-4 w-3/4 skeleton-shimmer rounded" />
          <div className="h-4 w-full skeleton-shimmer rounded" />
          <div className="h-4 w-5/6 skeleton-shimmer rounded" />
          <div className="h-4 w-2/3 skeleton-shimmer rounded" />
        </div>
      </div>
    );
  }

  // Breadcrumb path
  const segments = path.split("/");
  const isCode = isCodeFile(path);
  const isMd = isMarkdown(path) || isSkillMd(path);

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb header */}
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <FileIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-60" />
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="opacity-40">/</span>}
              <span className={i === segments.length - 1 ? "text-foreground" : ""}>
                {seg}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${isCode ? "p-0" : isMd ? "p-6" : "p-4"}`}>
        {rendered}
      </div>
    </div>
  );
}
