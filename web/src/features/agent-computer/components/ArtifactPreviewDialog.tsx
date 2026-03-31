"use client";

import { useCallback } from "react";
import { Download } from "lucide-react";
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
import {
  fileExtension,
  fileCategoryColor,
  fileIcon,
  formatFileSize,
} from "../lib/artifact-helpers";

interface ArtifactPreviewDialogProps {
  readonly artifact: ArtifactInfo | null;
  readonly artifactUrl: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ArtifactPreviewDialog({
  artifact,
  artifactUrl,
  open,
  onOpenChange,
}: ArtifactPreviewDialogProps) {
  const { t } = useTranslation();

  const handleDownload = useCallback(() => {
    if (!artifactUrl || !artifact) return;
    downloadFile(artifactUrl, artifact.name);
  }, [artifactUrl, artifact]);

  if (!artifact) return null;

  const ext = fileExtension(artifact.name);
  const colors = fileCategoryColor(artifact.contentType, artifact.name);
  const Icon = fileIcon(artifact.contentType, artifact.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded ${colors.bg}`}
            >
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
                {formatFileSize(artifact.size, t)}
              </span>
            )}
          </DialogTitle>
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
