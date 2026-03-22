"use client";

import { useState, useCallback } from "react";
import { Download, Eye, FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import { IconButton } from "@/shared/components/IconButton";
import { downloadFile } from "@/shared/lib/download";
import { useTranslation } from "@/i18n";
import type { ArtifactInfo } from "@/shared/types";
import {
  formatFileSize,
  fileIcon,
  fileCategory,
  fileExtension,
  fileCategoryColor,
  fileCategoryBorderColor,
  isPreviewable,
} from "../lib/artifact-helpers";
import { ArtifactPreviewDialog } from "./ArtifactPreviewDialog";

interface ArtifactFilesPanelProps {
  readonly artifacts: ArtifactInfo[];
  readonly conversationId: string | null;
}

export function ArtifactFilesPanel({ artifacts, conversationId }: ArtifactFilesPanelProps) {
  const { t } = useTranslation();
  const [previewArtifact, setPreviewArtifact] = useState<ArtifactInfo | null>(null);

  const getArtifactUrl = useCallback(
    (artifactId: string) =>
      conversationId
        ? `/api/conversations/${conversationId}/artifacts/${artifactId}`
        : null,
    [conversationId],
  );

  const handleDownload = useCallback(
    (artifact: ArtifactInfo) => {
      const url = getArtifactUrl(artifact.id);
      if (!url) return;
      downloadFile(url, artifact.name);
    },
    [getArtifactUrl],
  );

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
          <FolderOpen className="h-5 w-5 text-muted-foreground-dim" />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("artifacts.noFiles")}
        </p>
      </div>
    );
  }

  const previewUrl = previewArtifact ? getArtifactUrl(previewArtifact.id) : null;

  return (
    <div className="space-y-2 px-5 py-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        {artifacts.length === 1 ? t("artifacts.fileCount", { count: 1 }) : t("artifacts.filesCount", { count: artifacts.length })}
      </p>
      {artifacts.map((artifact, i) => {
        const Icon = fileIcon(artifact.contentType);
        const category = fileCategory(artifact.contentType, t);
        const colors = fileCategoryColor(artifact.contentType);
        const ext = fileExtension(artifact.name);
        const canPreview = isPreviewable(artifact.contentType);

        const handleRowClick = () => {
          if (canPreview) {
            setPreviewArtifact(artifact);
          } else {
            handleDownload(artifact);
          }
        };

        return (
          <motion.div
            key={artifact.id}
            className={`group flex items-center gap-3 rounded-md border border-border border-l-2 bg-card p-3 cursor-pointer transition-colors hover:bg-secondary`}
            style={{ borderLeftColor: fileCategoryBorderColor(artifact.contentType) }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, delay: i * 0.03 }}
            onClick={handleRowClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(); } }}
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${colors.bg}`}>
              <Icon className={`h-4 w-4 ${colors.icon}`} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium text-foreground" title={artifact.name}>
                  {artifact.name}
                </p>
                {ext && (
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-micro uppercase text-muted-foreground">
                    {ext}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {category} &middot; {formatFileSize(artifact.size, t)}
              </p>
            </div>

            <div
              className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              {canPreview && (
                <IconButton
                  icon={Eye}
                  label={t("artifacts.preview")}
                  size="icon-xs"
                  onClick={() => setPreviewArtifact(artifact)}
                />
              )}
              <IconButton
                icon={Download}
                label={t("artifacts.download")}
                size="icon-xs"
                onClick={() => handleDownload(artifact)}
              />
            </div>

            {artifact.contentType.startsWith("image/") && conversationId && (
              <div className="shrink-0">
                <img
                  src={`/api/conversations/${conversationId}/artifacts/${artifact.id}`}
                  alt={artifact.name}
                  className="h-9 w-9 rounded-md border border-border object-cover"
                />
              </div>
            )}
          </motion.div>
        );
      })}

      <ArtifactPreviewDialog
        artifact={previewArtifact}
        artifactUrl={previewUrl}
        open={previewArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewArtifact(null);
        }}
      />
    </div>
  );
}
