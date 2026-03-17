"use client";

import { useCallback } from "react";
import {
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  File,
  Download,
  Eye,
  FolderOpen,
} from "lucide-react";
import { motion } from "framer-motion";
import { IconButton } from "@/shared/components/IconButton";
import type { ArtifactInfo } from "@/shared/types";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType === "application/pdf") return FileText;
  if (contentType.includes("wordprocessingml")) return FileText;
  if (contentType.includes("presentationml")) return FileText;
  if (
    contentType.startsWith("text/x-") ||
    contentType === "text/javascript" ||
    contentType === "application/json"
  )
    return FileCode;
  if (
    contentType === "text/csv" ||
    contentType.includes("spreadsheet")
  )
    return FileSpreadsheet;
  if (contentType.startsWith("text/")) return FileText;
  return File;
}

function fileCategory(contentType: string): string {
  if (contentType.startsWith("image/")) return "Image";
  if (contentType === "application/pdf") return "PDF";
  if (contentType.includes("wordprocessingml")) return "Document";
  if (contentType.includes("spreadsheet")) return "Spreadsheet";
  if (contentType.includes("presentationml")) return "Presentation";
  if (contentType.startsWith("text/x-") || contentType === "text/javascript" || contentType === "application/json")
    return "Code";
  if (contentType === "text/csv") return "Data";
  if (contentType === "text/html") return "HTML";
  if (contentType.startsWith("text/")) return "Text";
  return "File";
}

interface ArtifactFilesPanelProps {
  readonly artifacts: ArtifactInfo[];
  readonly conversationId: string | null;
}

export function ArtifactFilesPanel({ artifacts, conversationId }: ArtifactFilesPanelProps) {
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
      const a = document.createElement("a");
      a.href = url;
      a.download = artifact.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [getArtifactUrl],
  );

  const handlePreview = useCallback(
    (artifact: ArtifactInfo) => {
      const url = getArtifactUrl(artifact.id);
      if (!url) return;
      window.open(`${url}?inline=1`, "_blank", "noopener,noreferrer");
    },
    [getArtifactUrl],
  );

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <FolderOpen className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <p className="text-xs text-muted-foreground">
          No files generated yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-5 py-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        {artifacts.length} file{artifacts.length !== 1 ? "s" : ""} generated
      </p>
      {artifacts.map((artifact, i) => {
        const Icon = fileIcon(artifact.contentType);
        const category = fileCategory(artifact.contentType);
        const isPreviewable =
          artifact.contentType.startsWith("image/") ||
          artifact.contentType === "application/pdf" ||
          artifact.contentType.startsWith("text/");

        return (
          <motion.div
            key={artifact.id}
            className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, delay: i * 0.03 }}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {artifact.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {category} &middot; {formatFileSize(artifact.size)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {isPreviewable && (
                <IconButton
                  icon={Eye}
                  label="Preview in new tab"
                  size="icon-xs"
                  onClick={() => handlePreview(artifact)}
                />
              )}
              <IconButton
                icon={Download}
                label="Download"
                size="icon-xs"
                onClick={() => handleDownload(artifact)}
              />
            </div>

            {/* Image thumbnail for image artifacts */}
            {artifact.contentType.startsWith("image/") && conversationId && (
              <div className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
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
    </div>
  );
}
