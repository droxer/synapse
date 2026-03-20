"use client";

import { useState, useEffect, useCallback } from "react";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CodeOutput } from "@/shared/components/ui/code-output";
import { useTranslation } from "@/i18n";
import type { ArtifactInfo } from "@/shared/types";
import {
  fileExtension,
  fileCategoryColor,
  fileIcon,
  formatFileSize,
} from "../lib/artifact-helpers";

/** Map file extensions to highlight.js language identifiers. */
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

interface ArtifactPreviewDialogProps {
  readonly artifact: ArtifactInfo | null;
  readonly artifactUrl: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function isCodeType(ct: string): boolean {
  return (
    ct.startsWith("text/x-") ||
    ct === "text/javascript" ||
    ct === "application/json"
  );
}

function isTextType(ct: string): boolean {
  return (
    ct === "text/plain" ||
    ct === "text/markdown" ||
    ct === "text/csv"
  );
}

export function ArtifactPreviewDialog({
  artifact,
  artifactUrl,
  open,
  onOpenChange,
}: ArtifactPreviewDialogProps) {
  const { t } = useTranslation();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [imageZoomed, setImageZoomed] = useState(false);

  const ct = artifact?.contentType ?? "";
  const inlineUrl = artifactUrl ? `${artifactUrl}?inline=1` : null;
  const needsFetch = isCodeType(ct) || isTextType(ct);

  useEffect(() => {
    if (!open || !inlineUrl || !needsFetch) {
      setTextContent(null);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    fetch(inlineUrl)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setTextContent(text);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, inlineUrl, needsFetch]);

  // Reset zoom when dialog closes
  useEffect(() => {
    if (!open) setImageZoomed(false);
  }, [open]);

  const handleDownload = useCallback(() => {
    if (!artifactUrl || !artifact) return;
    const a = document.createElement("a");
    a.href = artifactUrl;
    a.download = artifact.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [artifactUrl, artifact]);

  if (!artifact) return null;

  const ext = fileExtension(artifact.name);
  const colors = fileCategoryColor(ct);
  const Icon = fileIcon(ct);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex h-48 flex-col justify-center gap-3 px-4" aria-busy="true" aria-label={t("artifacts.previewLoading")}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <p className="text-sm text-muted-foreground">{t("artifacts.previewLoading")}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p className="text-sm">{t("artifacts.previewError")}</p>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("artifacts.downloadFile")}
          </Button>
        </div>
      );
    }

    // Image preview
    if (ct.startsWith("image/") && inlineUrl) {
      return (
        <div className="flex justify-center overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={inlineUrl}
            alt={artifact.name}
            className={
              imageZoomed
                ? "max-w-none cursor-zoom-out"
                : "max-h-[70vh] cursor-zoom-in object-contain"
            }
            onClick={() => setImageZoomed((z) => !z)}
          />
        </div>
      );
    }

    // Code / text preview
    if ((isCodeType(ct) || isTextType(ct)) && textContent !== null) {
      const lang = ext ? EXT_TO_LANG[ext] : undefined;
      return <CodeOutput output={textContent} icon={Icon} label={ext || undefined} language={lang} />;
    }

    // HTML preview
    if (ct === "text/html" && inlineUrl) {
      return (
        <iframe
          src={inlineUrl}
          title={artifact.name}
          sandbox="allow-scripts allow-same-origin"
          className="h-[70vh] w-full rounded-md border border-border"
        />
      );
    }

    // PDF preview
    if (ct === "application/pdf" && inlineUrl) {
      return (
        <iframe
          src={inlineUrl}
          title={artifact.name}
          className="h-[70vh] w-full rounded-md border border-border"
        />
      );
    }

    // Fallback
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">{t("artifacts.previewUnsupported")}</p>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {t("artifacts.downloadFile")}
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${colors.bg}`}>
              <Icon className={`h-3.5 w-3.5 ${colors.icon}`} />
            </span>
            <span className="truncate">{artifact.name}</span>
            {ext && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-micro uppercase text-muted-foreground">
                {ext}
              </span>
            )}
            {artifact.size > 0 && (
              <span className="text-xs text-muted-foreground">
                {formatFileSize(artifact.size)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-auto">{renderContent()}</div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("artifacts.downloadFile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
