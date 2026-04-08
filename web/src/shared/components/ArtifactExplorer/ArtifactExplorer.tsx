"use client";

import { useCallback, useMemo } from "react";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "@/i18n";
import { EmptyState } from "@/shared/components/EmptyState";
import { downloadFile } from "@/shared/lib/download";
import { ArtifactPreviewDialog } from "@/features/agent-computer/components/ArtifactPreviewDialog";
import { ExplorerFileList } from "./ExplorerFileList";
import {
  groupByConversation,
  buildArtifactUrl,
} from "./artifactExplorerUtils";
import { useArtifactExplorer } from "./useArtifactExplorer";
import type { ArtifactExplorerItem, ConversationNode } from "./artifactExplorerUtils";
import type { LibraryGroup, ViewMode } from "@/features/library/types";
import type { ArtifactInfo } from "@/shared/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ArtifactExplorerProps {
  /** Panel mode: pass raw artifact items from SSE events */
  readonly artifacts?: readonly ArtifactInfo[];
  readonly conversationId?: string | null;
  /** Page mode: pass library groups */
  readonly groups?: readonly LibraryGroup[];
  readonly mode: "panel" | "page";
  /** Page mode only: controls grid vs list layout. Defaults to "grid". */
  readonly viewMode?: ViewMode;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function ArtifactExplorer({
  artifacts,
  conversationId,
  groups,
  mode,
  viewMode = "grid",
}: ArtifactExplorerProps) {
  const { t } = useTranslation();

  const {
    selectedFileId,
    selectedIds,
    selectFile,
    toggleSelection,
    selectAll,
    clearSelection,
  } = useArtifactExplorer();

  // ── Build normalized item list ──────────────────────────────────────────

  const allItems = useMemo((): readonly ArtifactExplorerItem[] => {
    if (mode === "panel") {
      const raw = artifacts ?? [];
      return raw.map(
        (a): ArtifactExplorerItem => ({
          id: a.id,
          name: a.name,
          contentType: a.contentType,
          size: a.size,
          conversationId: conversationId ?? undefined,
          filePath: a.filePath || a.name,
        }),
      );
    }

    // Page mode: flatten all conversation groups
    const groupList = groups ?? [];
    return groupList.flatMap((group) =>
      group.artifacts.map(
        (artifact): ArtifactExplorerItem => ({
          id: artifact.id,
          name: artifact.name,
          contentType: artifact.content_type,
          size: artifact.size,
          conversationId: group.conversation_id,
          conversationTitle: group.title ?? t("library.untitledTask"),
          createdAt: artifact.created_at,
          filePath: artifact.file_path || artifact.name,
        }),
      ),
    );
  }, [mode, artifacts, conversationId, groups]);

  // ── Build folder structure ───────────────────────────────────────────────

  const conversationNodes = useMemo(
    (): readonly ConversationNode[] =>
      mode === "page" ? groupByConversation(groups ?? []) : [],
    [mode, groups],
  );

  // ── Derive selected item + URL ───────────────────────────────────────────

  const selectedItem = useMemo(
    () => allItems.find((item) => item.id === selectedFileId) ?? null,
    [allItems, selectedFileId],
  );

  const selectedUrl = useMemo(
    () =>
      selectedItem
        ? buildArtifactUrl(selectedItem, mode === "panel" ? conversationId : null)
        : null,
    [selectedItem, mode, conversationId],
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  const handlePreview = useCallback(
    (item: ArtifactExplorerItem) => {
      selectFile(item.id);
    },
    [selectFile],
  );

  const handleDownload = useCallback(
    (item: ArtifactExplorerItem) => {
      const url = buildArtifactUrl(item, mode === "panel" ? conversationId : null);
      if (url) {
        downloadFile(url, item.name);
      }
    },
    [mode, conversationId],
  );

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) selectFile(null);
    },
    [selectFile],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    // Group selected IDs by conversation
    const selectedItems = allItems.filter(item => selectedIds.has(item.id));
    const byConversation = new Map<string, string[]>();

    for (const item of selectedItems) {
      const cId = item.conversationId || conversationId;
      if (!cId) continue;
      if (!byConversation.has(cId)) byConversation.set(cId, []);
      byConversation.get(cId)!.push(item.id);
    }

    try {
      await Promise.all(
        Array.from(byConversation.entries()).map(([cId, ids]) =>
          fetch(`/api/conversations/${cId}/artifacts/bulk`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artifact_ids: ids }),
          })
        )
      );
      clearSelection();
    } catch (error) {
      console.error("Failed to bulk delete artifacts", error);
    }
  }, [selectedIds, allItems, conversationId, clearSelection]);

  // ── Empty state ──────────────────────────────────────────────────────────

  if (allItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={FolderOpen}
          title={t("library.noArtifacts", { defaultValue: "No artifacts found" })}
          description={t("library.noArtifactsHint", { defaultValue: "Artifacts will appear here when generated." })}
        />
      </div>
    );
  }

  // ── Main Layout ──────────────────────────────────────────────────────────

  const dialogArtifact = selectedItem
    ? {
        id: selectedItem.id,
        name: selectedItem.name,
        contentType: selectedItem.contentType,
        size: selectedItem.size,
      }
    : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <div className="flex-1 min-w-0">
        <ExplorerFileList
          items={allItems}
          groups={mode === "page" ? conversationNodes : undefined}
          selectedFileId={selectedFileId}
          selectedIds={selectedIds}
          conversationId={conversationId ?? undefined}
          onSelectFile={selectFile}
          onPreview={handlePreview}
          onDownload={handleDownload}
          onToggleSelection={toggleSelection}
          onSelectAll={selectAll}
          onDeleteSelected={handleDeleteSelected}
          mode={mode}
          viewMode={viewMode}
        />
      </div>
      <ArtifactPreviewDialog
        artifact={dialogArtifact}
        artifactUrl={selectedUrl}
        open={selectedFileId !== null}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  );
}
