"use client";

import { useCallback } from "react";
import { Download, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { FilePreview } from "@/shared/components/FilePreview";
import { downloadFile } from "@/shared/lib/download";
import { useTranslation } from "@/i18n";
import type { ArtifactInfo } from "@/shared/types";
import { BrandFileTypeIcon } from "@/shared/components/file-type-icons/BrandFileTypeIcon";
import {
  fileExtension,
  fileCategoryColor,
  formatFileSize,
} from "../lib/artifact-helpers";

interface ArtifactPreviewDialogProps {
  readonly artifact: ArtifactInfo | null;
  readonly artifactUrl: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** When set, shows a delete control that starts the parent delete confirmation flow. */
  readonly onRequestDelete?: () => void;
}

export function ArtifactPreviewDialog({
  artifact,
  artifactUrl,
  open,
  onOpenChange,
  onRequestDelete,
}: ArtifactPreviewDialogProps) {
  const { t, locale } = useTranslation();

  const handleDownload = useCallback(() => {
    if (!artifactUrl || !artifact) return;
    downloadFile(artifactUrl, artifact.name);
  }, [artifactUrl, artifact]);

  if (!artifact) return null;

  const ext = fileExtension(artifact.name);
  const colors = fileCategoryColor(artifact.contentType, artifact.name);
  const createdLabel =
    artifact.createdAt &&
    !Number.isNaN(new Date(artifact.createdAt).getTime())
      ? new Date(artifact.createdAt).toLocaleString(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${colors.bg}`}
            >
              <BrandFileTypeIcon
                name={artifact.name}
                contentType={artifact.contentType}
                className={`h-3.5 w-3.5 ${colors.icon}`}
              />
            </span>
            <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
            {ext && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-micro uppercase text-muted-foreground">
                {ext}
              </span>
            )}
            {artifact.size > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(artifact.size, t)}
              </span>
            )}
          </DialogTitle>
          {createdLabel && (
            <p className="text-xs text-muted-foreground">{createdLabel}</p>
          )}
        </DialogHeader>

        <div className="max-h-[75vh] overflow-auto">
          {artifactUrl && (
            <FilePreview
              url={artifactUrl}
              contentType={artifact.contentType}
              fileName={artifact.name}
              onDownload={handleDownload}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {onRequestDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-muted hover:text-destructive"
              onClick={onRequestDelete}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("explorer.delete")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("artifacts.downloadFile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
