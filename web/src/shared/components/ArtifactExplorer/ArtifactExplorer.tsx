"use client";

import { useCallback, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "@/i18n";
import { EmptyState } from "@/shared/components/EmptyState";
import { Button } from "@/shared/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
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
import { useAppStore } from "@/shared/stores";

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
  /** Page mode: optimistically drop deleted artifacts from library state after a successful API delete. */
  readonly onLibraryArtifactsRemoved?: (artifactIds: readonly string[]) => void;
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
  onLibraryArtifactsRemoved,
}: ArtifactExplorerProps) {
  const { t } = useTranslation();

  const { selectedFileId, selectFile } = useArtifactExplorer();

  const [deleteTargetIds, setDeleteTargetIds] = useState<readonly string[] | null>(null);

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
          createdAt: a.createdAt,
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
  }, [mode, artifacts, conversationId, groups, t]);

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

  const canDelete =
    mode === "page" ||
    (mode === "panel" && typeof conversationId === "string" && conversationId.length > 0);

  const performDelete = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      if (ids.length === 0) return false;
      const idSet = new Set(ids);
      const byConversation = new Map<string, string[]>();

      for (const id of idSet) {
        const item = allItems.find((i) => i.id === id);
        const cId =
          item?.conversationId ?? (mode === "panel" ? conversationId ?? undefined : undefined);
        if (!cId) return false;
        if (!byConversation.has(cId)) byConversation.set(cId, []);
        byConversation.get(cId)!.push(id);
      }

      try {
        const responses = await Promise.all(
          Array.from(byConversation.entries()).map(([cId, artifactIds]) =>
            fetch(`/api/conversations/${cId}/artifacts/bulk`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ artifact_ids: artifactIds }),
            }),
          ),
        );
        if (!responses.every((r) => r.ok)) return false;

        useAppStore.getState().recordArtifactsDeleted(ids);
        if (mode === "page") {
          onLibraryArtifactsRemoved?.(ids);
        }

        if (selectedFileId && idSet.has(selectedFileId)) selectFile(null);
        return true;
      } catch (error) {
        console.error("Failed to delete artifacts", error);
        return false;
      }
    },
    [allItems, conversationId, mode, onLibraryArtifactsRemoved, selectFile, selectedFileId],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTargetIds?.length) return;
    const ok = await performDelete(deleteTargetIds);
    if (ok) setDeleteTargetIds(null);
  }, [deleteTargetIds, performDelete]);

  const openDeleteDialog = useCallback((ids: readonly string[]) => {
    if (ids.length === 0 || !canDelete) return;
    setDeleteTargetIds([...ids]);
  }, [canDelete]);

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
        ...(selectedItem.createdAt ? { createdAt: selectedItem.createdAt } : {}),
      }
    : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <div className="flex-1 min-w-0">
        <ExplorerFileList
          items={allItems}
          groups={mode === "page" ? conversationNodes : undefined}
          selectedFileId={selectedFileId}
          conversationId={conversationId ?? undefined}
          canDelete={canDelete}
          onSelectFile={selectFile}
          onPreview={handlePreview}
          onDownload={handleDownload}
          onOpenDeleteDialog={openDeleteDialog}
          mode={mode}
          viewMode={viewMode}
        />
      </div>
      <ArtifactPreviewDialog
        artifact={dialogArtifact}
        artifactUrl={selectedUrl}
        open={selectedFileId !== null}
        onOpenChange={handleDialogOpenChange}
        onRequestDelete={
          canDelete && selectedItem ? () => openDeleteDialog([selectedItem.id]) : undefined
        }
      />

      <AlertDialog
        open={deleteTargetIds !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetIds(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("explorer.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("explorer.deleteConfirmDesc", { count: deleteTargetIds?.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">{t("explorer.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmDelete()}
            >
              {t("explorer.deleteConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
