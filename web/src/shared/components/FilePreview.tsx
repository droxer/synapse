"use client";

import { useState, useEffect, useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CodeOutput } from "@/shared/components/ui/code-output";
import { useTranslation } from "@/i18n";
import {
  fileExtension,
  fileCategoryColor,
  fileIcon,
} from "@/features/agent-computer/lib/artifact-helpers";

/* ------------------------------------------------------------------ */
/*  Content-type classifiers                                          */
/* ------------------------------------------------------------------ */

function isCodeType(ct: string): boolean {
  return (
    ct.startsWith("text/x-") ||
    ct === "text/javascript" ||
    ct === "application/json"
  );
}

function isTextType(ct: string): boolean {
  return ct === "text/plain" || ct === "text/markdown" || ct === "text/csv";
}

function isDocxType(ct: string): boolean {
  return ct.includes("wordprocessingml") || ct === "application/msword";
}

function isXlsxType(ct: string): boolean {
  return ct.includes("spreadsheetml") || ct === "application/vnd.ms-excel";
}

function isPptxType(ct: string): boolean {
  return ct.includes("presentationml") || ct === "application/vnd.ms-powerpoint";
}

/* ------------------------------------------------------------------ */
/*  Extension → highlight.js language map                             */
/* ------------------------------------------------------------------ */

const EXT_TO_LANG: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "html",
  css: "css",
  sh: "bash",
  toml: "toml",
  sql: "sql",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  lua: "lua",
  r: "r",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Resolve a possibly-relative URL to an absolute URL. */
function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window === "undefined") return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Build a Google Docs Viewer iframe URL for office documents. */
function googleDocsViewerUrl(artifactUrl: string): string {
  const absolute = toAbsoluteUrl(artifactUrl);
  return `https://docs.google.com/gview?url=${encodeURIComponent(absolute)}&embedded=true`;
}

function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
}

/* ------------------------------------------------------------------ */
/*  Office conversion: fetch binary + convert client-side             */
/* ------------------------------------------------------------------ */

async function convertDocxToHtml(url: string): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

async function convertXlsxToHtml(url: string): Promise<string> {
  const XLSX = await import("xlsx");
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const tableHtml = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${sheetName}` });
    parts.push(
      `<div style="margin-bottom:1.5em;">` +
        `<h3 class="sheet-title">${sheetName}</h3>` +
        tableHtml +
      `</div>`,
    );
  }
  return parts.join("");
}

/* ------------------------------------------------------------------ */
/*  Shared styles injected into office preview iframes                */
/* ------------------------------------------------------------------ */

const OFFICE_IFRAME_STYLES = `
<style>
  body {
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
    padding: 24px 32px;
    margin: 0;
    color: var(--color-foreground, #0f172a);
    background: var(--color-background, #f8fafc);
    line-height: 1.6;
    font-size: 0.875rem;
  }
  .sheet-title { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
  /* mammoth docx styles */
  h1 { font-size: 1.6em; margin: 0.8em 0 0.4em; }
  h2 { font-size: 1.3em; margin: 0.8em 0 0.4em; }
  h3 { font-size: 1.1em; margin: 0.6em 0 0.3em; }
  p { margin: 0.4em 0; }
  img { max-width: 100%; height: auto; }
  /* xlsx table styles */
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.75rem;
  }
  th, td {
    border: 1px solid var(--color-border, #e2e8f0);
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
  }
  th {
    background: var(--color-secondary, #f1f5f9);
    font-weight: 600;
  }
  tr:nth-child(even) { background: var(--color-muted, #f1f5f9); }
  tr:hover { background: var(--color-secondary, #f1f5f9); }
</style>
`;

function buildOfficeIframeContent(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${OFFICE_IFRAME_STYLES}</head><body>${bodyHtml}</body></html>`;
}

/* ------------------------------------------------------------------ */
/*  FilePreview component                                             */
/* ------------------------------------------------------------------ */

interface FilePreviewProps {
  /** URL to fetch / display the file (can be relative). */
  readonly url: string;
  /** MIME content type. */
  readonly contentType: string;
  /** Display name of the file. */
  readonly fileName: string;
  /** Called when the user clicks a download button inside the preview. */
  readonly onDownload?: () => void;
  /** Extra wrapper class names. */
  readonly className?: string;
}

/**
 * Content state machine:
 *  - idle      → nothing loaded yet / not needed
 *  - loading   → fetching + converting
 *  - ready     → content available in `html` or `text`
 *  - error     → fetch or conversion failed
 */
type ContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; html?: string; text?: string }
  | { status: "error" };

export function FilePreview({
  url,
  contentType,
  fileName,
  onDownload,
  className,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<ContentState>({ status: "idle" });
  const [imageZoomed, setImageZoomed] = useState(false);

  const ct = contentType;
  const inlineUrl = `${url}${url.includes("?") ? "&" : "?"}inline=1`;

  const ext = useMemo(() => fileExtension(fileName), [fileName]);
  const colors = useMemo(() => fileCategoryColor(ct, fileName), [ct, fileName]);
  const Icon = useMemo(() => fileIcon(ct, fileName), [ct, fileName]);

  /* Determine what kind of fetching we need */
  const fetchMode = useMemo((): "text" | "docx" | "xlsx" | "none" => {
    if (isCodeType(ct) || isTextType(ct)) return "text";
    if (isDocxType(ct)) return "docx";
    if (isXlsxType(ct)) return "xlsx";
    return "none";
  }, [ct]);

  /* Fetch & convert content */
  useEffect(() => {
    if (fetchMode === "none") {
      setContent({ status: "idle" });
      return;
    }

    let cancelled = false;
    setContent({ status: "loading" });

    const run = async () => {
      try {
        if (fetchMode === "text") {
          const res = await fetch(inlineUrl);
          if (!res.ok) throw new Error("fetch failed");
          const text = await res.text();
          if (!cancelled) setContent({ status: "ready", text });
        } else if (fetchMode === "docx") {
          const html = await convertDocxToHtml(inlineUrl);
          if (!cancelled) setContent({ status: "ready", html });
        } else if (fetchMode === "xlsx") {
          const html = await convertXlsxToHtml(inlineUrl);
          if (!cancelled) setContent({ status: "ready", html });
        }
      } catch {
        if (!cancelled) setContent({ status: "error" });
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [inlineUrl, fetchMode]);

  const downloadButton = onDownload ? (
    <Button variant="outline" size="sm" onClick={onDownload}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      {t("artifacts.downloadFile")}
    </Button>
  ) : null;

  /* ---- Loading ---- */
  if (content.status === "loading") {
    return (
      <div
        className={className}
        aria-busy="true"
        aria-label={t("artifacts.previewLoading")}
      >
        <div className="flex h-48 flex-col justify-center gap-3 px-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <p className="text-sm text-muted-foreground">
            {t("artifacts.previewLoading")}
          </p>
        </div>
      </div>
    );
  }

  /* ---- Error ---- */
  if (content.status === "error") {
    return (
      <div className={className}>
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p className="text-sm">{t("artifacts.previewError")}</p>
          {downloadButton}
        </div>
      </div>
    );
  }

  /* ---- Image ---- */
  if (ct.startsWith("image/")) {
    return (
      <div className={className}>
        <div className="flex justify-center overflow-auto">
          <img
            src={inlineUrl}
            alt={fileName}
            className={
              imageZoomed
                ? "max-w-none cursor-zoom-out"
                : "max-h-[70vh] cursor-zoom-in object-contain"
            }
            onClick={() => setImageZoomed((z) => !z)}
          />
        </div>
      </div>
    );
  }

  /* ---- Code / plain text ---- */
  if ((isCodeType(ct) || isTextType(ct)) && content.status === "ready" && content.text != null) {
    const lang = ext ? EXT_TO_LANG[ext] : undefined;
    return (
      <div className={className}>
        <CodeOutput
          output={content.text}
          icon={Icon}
          label={ext || undefined}
          language={lang}
        />
      </div>
    );
  }

  /* ---- HTML ---- */
  if (ct === "text/html") {
    return (
      <div className={className}>
        <iframe
          src={inlineUrl}
          title={fileName}
          sandbox="allow-scripts allow-same-origin"
          className="h-[70vh] w-full rounded-md border border-border"
        />
      </div>
    );
  }

  /* ---- PDF ---- */
  if (ct === "application/pdf") {
    return (
      <div className={className}>
        <iframe
          src={inlineUrl}
          title={fileName}
          className="h-[70vh] w-full rounded-md border border-border"
        />
      </div>
    );
  }

  /* ---- DOCX / XLSX (client-side converted to HTML) ---- */
  if ((isDocxType(ct) || isXlsxType(ct)) && content.status === "ready" && content.html != null) {
    const srcDoc = buildOfficeIframeContent(content.html);
    return (
      <div className={className}>
        <iframe
          srcDoc={srcDoc}
          title={fileName}
          sandbox="allow-same-origin"
          className="h-[70vh] w-full rounded-md border border-border"
        />
      </div>
    );
  }

  /* ---- PPTX — Google Docs Viewer for public URLs, download fallback ---- */
  if (isPptxType(ct)) {
    if (isLocalHost()) {
      return (
        <div className={className}>
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${colors.bg}`}>
              <Icon className={`h-6 w-6 ${colors.icon}`} />
            </div>
            <p className="text-sm">{t("artifacts.previewOfficeLocal")}</p>
            {downloadButton}
          </div>
        </div>
      );
    }

    return (
      <div className={className}>
        <iframe
          src={googleDocsViewerUrl(url)}
          title={fileName}
          className="h-[70vh] w-full rounded-md border border-border"
        />
      </div>
    );
  }

  /* ---- Fallback ---- */
  return (
    <div className={className}>
      <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">{t("artifacts.previewUnsupported")}</p>
        {downloadButton}
      </div>
    </div>
  );
}
