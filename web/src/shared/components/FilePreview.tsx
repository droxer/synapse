"use client";

import { useState, useEffect, useMemo } from "react";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CodeOutput } from "@/shared/components/ui/code-output";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { useTranslation } from "@/i18n";
import {
  fileExtension,
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

function isMarkdownType(ct: string, fileName: string): boolean {
  return ct === "text/markdown" || fileExtension(fileName) === "md";
}

function isDocxType(ct: string): boolean {
  return ct.includes("wordprocessingml") || ct === "application/msword";
}

function isXlsxType(ct: string): boolean {
  return ct.includes("spreadsheetml") || ct === "application/vnd.ms-excel";
}

function isPptxType(ct: string, fileName: string): boolean {
  if (ct.includes("presentationml") || ct === "application/vnd.ms-powerpoint") {
    return true;
  }
  const ext = fileExtension(fileName);
  return ext === "ppt" || ext === "pptx";
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

function buildArtifactPreviewManifestUrl(artifactUrl: string): string | null {
  const urlWithoutQuery = artifactUrl.split("?")[0] ?? artifactUrl;
  if (!urlWithoutQuery) return null;
  return `${urlWithoutQuery}/preview`;
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
  :root {
    color-scheme: light dark;
    --preview-font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", sans-serif;
    --preview-background: #FFFFFF;
    --preview-foreground: #000000;
    --preview-secondary: #EEF4FF;
    --preview-muted: #F4F7FB;
    --preview-border: #E4E6EB;
    --preview-hover: #F7FAFF;
  }
  .dark {
    --preview-background: #101114;
    --preview-foreground: #FFFFFF;
    --preview-secondary: #172033;
    --preview-muted: #1A1F2B;
    --preview-border: #2A2D33;
    --preview-hover: #1D2432;
  }
  html:lang(zh-CN) {
    --preview-font-sans: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  html:lang(zh-TW) {
    --preview-font-sans: "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
  }

  body {
    /* srcDoc iframes do not inherit next/font @font-face rules; use local/system fonts only. */
    font-family: var(--preview-font-sans);
    padding: 1rem 1.25rem;
    margin: 0;
    color: var(--preview-foreground);
    background: var(--preview-background);
    line-height: 1.5;
    font-size: 0.875rem;
  }
  .sheet-title { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; }
  /* mammoth docx styles */
  h1 { font-size: 1.25rem; margin: 1rem 0 0.5rem; line-height: 1.2; }
  h2 { font-size: 1.125rem; margin: 0.875rem 0 0.5rem; line-height: 1.2; }
  h3 { font-size: 1rem; margin: 0.75rem 0 0.375rem; line-height: 1.3; }
  p { margin: 0.5rem 0; }
  img { max-width: 100%; height: auto; }
  /* xlsx table styles */
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  th, td {
    border: 1px solid var(--preview-border);
    padding: 0.375rem 0.625rem;
    text-align: left;
    white-space: nowrap;
  }
  th {
    background: var(--preview-secondary);
    font-weight: 600;
  }
  tr:nth-child(even) { background: var(--preview-muted); }
  tr:hover { background: var(--preview-hover); }
</style>
`;

function buildOfficeIframeContent(bodyHtml: string, isDarkTheme: boolean, locale: string): string {
  const htmlClass = isDarkTheme ? " class=\"dark\"" : "";
  return `<!DOCTYPE html><html lang="${locale}"${htmlClass}><head><meta charset="utf-8">${OFFICE_IFRAME_STYLES}</head><body>${bodyHtml}</body></html>`;
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
  | { status: "ppt-ready"; manifest: PptPreviewManifest }
  | { status: "error" };

interface PptPreviewSlide {
  readonly index: number;
  readonly image_url: string;
}

interface PptPreviewManifest {
  readonly kind: "slides";
  readonly file_name: string;
  readonly slide_count: number;
  readonly slides: readonly PptPreviewSlide[];
}

export function FilePreview({
  url,
  contentType,
  fileName,
  onDownload,
  className,
}: FilePreviewProps) {
  const { locale, t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [content, setContent] = useState<ContentState>({ status: "idle" });
  const [imageZoomed, setImageZoomed] = useState(false);

  const ct = contentType;
  const isDarkTheme = resolvedTheme === "dark";
  const inlineUrl = `${url}${url.includes("?") ? "&" : "?"}inline=1`;

  const ext = useMemo(() => fileExtension(fileName), [fileName]);
  const Icon = useMemo(() => fileIcon(ct, fileName), [ct, fileName]);

  /* Determine what kind of fetching we need */
  const fetchMode = useMemo((): "text" | "docx" | "xlsx" | "ppt" | "none" => {
    if (isCodeType(ct) || isTextType(ct)) return "text";
    if (isDocxType(ct)) return "docx";
    if (isXlsxType(ct)) return "xlsx";
    if (isPptxType(ct, fileName)) return "ppt";
    return "none";
  }, [ct, fileName]);

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
        } else if (fetchMode === "ppt") {
          const manifestUrl = buildArtifactPreviewManifestUrl(url);
          if (!manifestUrl) throw new Error("missing preview manifest url");
          const res = await fetch(manifestUrl);
          if (!res.ok) throw new Error("fetch failed");
          const manifest = (await res.json()) as PptPreviewManifest;
          if (manifest.kind !== "slides") throw new Error("unsupported preview kind");
          if (!cancelled) setContent({ status: "ppt-ready", manifest });
        }
      } catch (err) {
        console.error("FilePreview fetch failed:", err);
        if (!cancelled) setContent({ status: "error" });
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [fetchMode, inlineUrl, url]);

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
            width={800}
            height={600}
            loading="lazy"
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
    if (isMarkdownType(ct, fileName)) {
      return (
        <div className={className}>
          <div className="rounded-md border border-border bg-background px-4 py-3">
            <MarkdownRenderer content={content.text} isStreaming={false} />
          </div>
        </div>
      );
    }

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
          sandbox="allow-same-origin"
          className="h-[70vh] w-full rounded-md border border-border"
        />
      </div>
    );
  }

  /* ---- DOCX / XLSX (client-side converted to HTML) ---- */
  if ((isDocxType(ct) || isXlsxType(ct)) && content.status === "ready" && content.html != null) {
    const srcDoc = buildOfficeIframeContent(content.html, isDarkTheme, locale);
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

  /* ---- PPT / PPTX (server-rendered slide images) ---- */
  if (isPptxType(ct, fileName) && content.status === "ppt-ready") {
    return (
      <div className={className}>
        <div className="grid gap-4 sm:grid-cols-2">
          {content.manifest.slides.map((slide) => (
            <figure
              key={slide.index}
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {`Slide ${slide.index}`}
              </div>
              <img
                src={slide.image_url}
                alt={`${fileName} slide ${slide.index}`}
                loading="lazy"
                className="w-full bg-muted object-contain"
              />
            </figure>
          ))}
        </div>
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
