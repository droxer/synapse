"use client";

import { useState, useCallback } from "react";
import { Download, Eye } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { downloadFile } from "@/shared/lib/download";
import { useTranslation } from "@/i18n";
import {
  fileIcon,
  fileCategory,
  fileCategoryColor,
  fileExtension,
  formatFileSize,
  isPreviewable,
} from "@/features/agent-computer/lib/artifact-helpers";
import { ArtifactPreviewDialog } from "@/features/agent-computer/components/ArtifactPreviewDialog";
import type { LibraryArtifact, ViewMode } from "../types";

interface LibraryArtifactCardProps {
  readonly artifact: LibraryArtifact;
  readonly conversationId: string;
  readonly viewMode: ViewMode;
}

function ListCard({
  artifact,
  artifactUrl: _artifactUrl,
  onPreview,
  onDownload,
}: {
  readonly artifact: LibraryArtifact;
  readonly artifactUrl: string;
  readonly onPreview: () => void;
  readonly onDownload: () => void;
}) {
  const { t } = useTranslation();
  const colors = fileCategoryColor(artifact.content_type);
  const Icon = fileIcon(artifact.content_type);
  const ext = fileExtension(artifact.name);
  const category = fileCategory(artifact.content_type, t);
  const canPreview = isPreviewable(artifact.content_type);

  const handleCardClick = canPreview ? onPreview : onDownload;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer",
        "transition-colors duration-150 hover:border-border-strong hover:bg-secondary/50",
      )}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCardClick(); }}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          colors.bg,
        )}
      >
        <Icon className={cn("h-4 w-4", colors.icon)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {artifact.name}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{category}</span>
          {ext && (
            <>
              <span className="text-border-strong">·</span>
              <span className="font-mono uppercase">{ext}</span>
            </>
          )}
          <span className="text-border-strong">·</span>
          <span>{formatFileSize(artifact.size, t)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {canPreview && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            aria-label={t("artifacts.preview")}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          aria-label={t("artifacts.download")}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function GridCard({
  artifact,
  artifactUrl,
  onPreview,
  onDownload,
}: {
  readonly artifact: LibraryArtifact;
  readonly artifactUrl: string;
  readonly onPreview: () => void;
  readonly onDownload: () => void;
}) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const colors = fileCategoryColor(artifact.content_type);
  const Icon = fileIcon(artifact.content_type);
  const ext = fileExtension(artifact.name);
  const category = fileCategory(artifact.content_type, t);
  const canPreview = isPreviewable(artifact.content_type);
  const isImage =
    artifact.content_type.startsWith("image/") && !imgError;

  const handleCardClick = canPreview ? onPreview : onDownload;

  return (
    <div
      className={cn(
        "group flex flex-col rounded-lg border border-border bg-card overflow-hidden cursor-pointer",
        "transition-colors duration-150 hover:border-border-strong hover:shadow-sm",
      )}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCardClick(); }}
    >
      {/* Thumbnail area */}
      <div className="relative h-40 w-full">
        {isImage ? (
          <img
            src={`${artifactUrl}?inline=1`}
            loading="lazy"
            alt={artifact.name}
            className="h-40 w-full object-cover bg-secondary"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-secondary/50">
            <Icon className={cn("h-10 w-10", colors.icon)} />
            {ext && (
              <span className="mt-1.5 text-xs font-mono uppercase text-muted-foreground">
                {ext}
              </span>
            )}
          </div>
        )}

        {/* Action overlay */}
        <div
          className={cn(
            "absolute bottom-0 right-0 flex items-center gap-1 p-1.5",
            "opacity-0 transition-opacity duration-150 group-hover:opacity-100",
            isImage && "bg-gradient-to-t from-black/30 to-transparent rounded-tl-md",
          )}
        >
          {canPreview && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              aria-label={t("artifacts.preview")}
              className={isImage ? "text-white hover:text-white hover:bg-white/20" : ""}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            aria-label={t("artifacts.download")}
            className={isImage ? "text-white hover:text-white hover:bg-white/20" : ""}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Info */}
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium text-foreground">
          {artifact.name}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{category}</span>
          {ext && (
            <>
              <span className="text-border-strong">·</span>
              <span className="font-mono uppercase">{ext}</span>
            </>
          )}
          <span className="text-border-strong">·</span>
          <span>{formatFileSize(artifact.size, t)}</span>
        </div>
      </div>
    </div>
  );
}

export function LibraryArtifactCard({
  artifact,
  conversationId,
  viewMode,
}: LibraryArtifactCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const artifactUrl = `/api/conversations/${conversationId}/artifacts/${artifact.id}`;

  const handleDownload = useCallback(() => {
    downloadFile(artifactUrl, artifact.name);
  }, [artifactUrl, artifact.name]);

  const handlePreview = useCallback(() => {
    setPreviewOpen(true);
  }, []);

  const CardComponent = viewMode === "grid" ? GridCard : ListCard;

  return (
    <>
      <CardComponent
        artifact={artifact}
        artifactUrl={artifactUrl}
        onPreview={handlePreview}
        onDownload={handleDownload}
      />

      <ArtifactPreviewDialog
        artifact={
          previewOpen
            ? {
                id: artifact.id,
                name: artifact.name,
                contentType: artifact.content_type,
                size: artifact.size,
              }
            : null
        }
        artifactUrl={previewOpen ? artifactUrl : null}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  );
}
