"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Clock3, Download, FolderOpen, Layers3, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { ArtifactPreviewDialog } from "@/features/agent-computer/components/ArtifactPreviewDialog";
import { formatFileSize, fileCategoryColor, fileCategory } from "@/features/agent-computer/lib/artifact-helpers";
import { BrandFileTypeIcon } from "@/shared/components/file-type-icons/BrandFileTypeIcon";
import { buildArtifactUrl } from "@/shared/components/ArtifactExplorer/artifactExplorerUtils";
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
import { useSessionFilteredArtifacts } from "@/shared/hooks/use-session-filtered-artifacts";
import { downloadFile } from "@/shared/lib/download";
import { formatRelativeDate } from "@/shared/lib/format-relative-date";
import { cn } from "@/shared/lib/utils";
import { useAppStore } from "@/shared/stores";
import type { ArtifactInfo } from "@/shared/types";
import type { FolderNode } from "@/shared/components/ArtifactExplorer/artifactExplorerUtils";
import {
  buildTaskArtifactTree,
  findFolderNode,
  hasNestedArtifactPaths,
  normalizeTaskArtifacts,
  splitRecentArtifacts,
  type TaskArtifactItem,
} from "./ArtifactFilesPanel.utils";

interface ArtifactFilesPanelProps {
  readonly artifacts: readonly ArtifactInfo[];
  readonly conversationId: string | null;
}

type PanelView = "recent" | "path";

function PreviewVisual({ artifact, conversationId }: {
  readonly artifact: TaskArtifactItem;
  readonly conversationId?: string | null;
}) {
  const { bg, icon } = fileCategoryColor(artifact.contentType, artifact.name);
  const artifactUrl = buildArtifactUrl(artifact, conversationId);

  if (artifact.contentType.startsWith("image/") && artifactUrl) {
    return (
      <div className="h-36 overflow-hidden rounded-xl border border-border bg-muted/40">
        <img
          src={artifactUrl}
          alt={artifact.name}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-36 items-end overflow-hidden rounded-xl border border-border px-4 py-3", bg)}>
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-background/30 to-transparent" />
      <div className="absolute -right-3 -top-4 h-20 w-20 rounded-full bg-background/30 blur-2xl" />
      <BrandFileTypeIcon
        name={artifact.name}
        contentType={artifact.contentType}
        className={cn("absolute right-4 top-4 h-10 w-10 opacity-15", icon)}
      />
      <div className="relative space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {artifact.contentType.startsWith("image/") ? "Image" : artifact.contentType === "text/html" ? "HTML" : "Preview"}
        </p>
        <div className="flex flex-col gap-1 opacity-70">
          <span className="h-1.5 w-28 rounded-full bg-current/25" />
          <span className="h-1.5 w-16 rounded-full bg-current/15" />
          <span className="h-1.5 w-20 rounded-full bg-current/10" />
        </div>
      </div>
    </div>
  );
}

function ArtifactMeta({ artifact }: { readonly artifact: TaskArtifactItem }) {
  const { t, locale } = useTranslation();
  const meta = artifact.createdAt ? formatRelativeDate(artifact.createdAt, locale) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{formatFileSize(artifact.size, t)}</span>
      <span aria-hidden="true">•</span>
      <span>{fileCategory(artifact.contentType, t)}</span>
      {meta ? (
        <>
          <span aria-hidden="true">•</span>
          <span title={meta.absolute}>{meta.relative}</span>
        </>
      ) : null}
    </div>
  );
}

function ArtifactActions({
  artifact,
  conversationId,
  canDelete,
  onPreview,
  onDelete,
}: {
  readonly artifact: TaskArtifactItem;
  readonly conversationId: string | null;
  readonly canDelete: boolean;
  readonly onPreview: (artifact: TaskArtifactItem) => void;
  readonly onDelete: (artifactIds: readonly string[]) => void;
}) {
  const { t } = useTranslation();
  const url = buildArtifactUrl(artifact, conversationId);

  return (
    <div className="flex items-center gap-1.5">
      {artifact.isPreviewable ? (
        <Button size="sm" variant="secondary" onClick={() => onPreview(artifact)}>
          {t("artifacts.preview")}
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("artifacts.downloadFile")}
        onClick={() => {
          if (url) downloadFile(url, artifact.name);
        }}
      >
        <Download className="h-4 w-4" />
      </Button>
      {canDelete ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("explorer.deleteFileLabel", { name: artifact.name })}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onDelete([artifact.id])}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function RecentArtifactCard({
  artifact,
  conversationId,
  canDelete,
  onPreview,
  onDelete,
  isFresh,
}: {
  readonly artifact: TaskArtifactItem;
  readonly conversationId: string | null;
  readonly canDelete: boolean;
  readonly onPreview: (artifact: TaskArtifactItem) => void;
  readonly onDelete: (artifactIds: readonly string[]) => void;
  readonly isFresh: boolean;
}) {
  const { t } = useTranslation();

  return (
    <article className="group rounded-2xl border border-border bg-card/80 p-3 shadow-sm transition-colors hover:border-border-strong">
      <button type="button" className="w-full text-left" onClick={() => onPreview(artifact)}>
        <PreviewVisual artifact={artifact} conversationId={conversationId} />
      </button>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{artifact.name}</p>
            {isFresh ? (
              <span className="rounded-full bg-accent-emerald/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-emerald">
                {t("artifacts.new")}
              </span>
            ) : null}
          </div>
          <ArtifactMeta artifact={artifact} />
          {artifact.directory ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{artifact.directory}</p>
          ) : null}
        </div>
        <ArtifactActions
          artifact={artifact}
          conversationId={conversationId}
          canDelete={canDelete}
          onPreview={onPreview}
          onDelete={onDelete}
        />
      </div>
    </article>
  );
}

function CompactArtifactRow({
  artifact,
  conversationId,
  canDelete,
  onPreview,
  onDelete,
}: {
  readonly artifact: TaskArtifactItem;
  readonly conversationId: string | null;
  readonly canDelete: boolean;
  readonly onPreview: (artifact: TaskArtifactItem) => void;
  readonly onDelete: (artifactIds: readonly string[]) => void;
}) {
  const { bg, icon } = fileCategoryColor(artifact.contentType, artifact.name);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5">
      <button
        type="button"
        className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", bg)}
        onClick={() => {
          if (artifact.isPreviewable) onPreview(artifact);
        }}
      >
        <BrandFileTypeIcon
          name={artifact.name}
          contentType={artifact.contentType}
          className={cn("h-5 w-5", icon)}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{artifact.name}</p>
        <ArtifactMeta artifact={artifact} />
        {artifact.directory ? (
          <p className="truncate text-xs text-muted-foreground">{artifact.directory}</p>
        ) : null}
      </div>
      <ArtifactActions
        artifact={artifact}
        conversationId={conversationId}
        canDelete={canDelete}
        onPreview={onPreview}
        onDelete={onDelete}
      />
    </div>
  );
}

function FolderBreadcrumbs({
  currentPath,
  onSelectPath,
}: {
  readonly currentPath: string;
  readonly onSelectPath: (path: string) => void;
}) {
  const { t } = useTranslation();
  const segments = currentPath === "/" ? [] : currentPath.split("/").filter(Boolean);
  const crumbs = [{ label: t("artifacts.pathRoot"), path: "/" }];
  let running = "";
  for (const segment of segments) {
    running = running ? `${running}/${segment}` : segment;
    crumbs.push({ label: segment, path: running });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {crumbs.map((crumb, index) => (
        <div key={crumb.path} className="flex items-center gap-1">
          {index > 0 ? <ChevronRight className="h-3.5 w-3.5" /> : null}
          <button type="button" className="hover:text-foreground" onClick={() => onSelectPath(crumb.path)}>
            {crumb.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function PathFolderButton({
  folder,
  onOpen,
}: {
  readonly folder: FolderNode;
  readonly onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-left transition-colors hover:border-border-strong hover:bg-card"
      onClick={() => onOpen(folder.path)}
    >
      <FolderOpen className="h-4 w-4 text-muted-foreground" />
      <span className="truncate">{folder.name}</span>
    </button>
  );
}

export function ArtifactFilesPanel({ artifacts, conversationId }: ArtifactFilesPanelProps) {
  const { t } = useTranslation();
  const filteredArtifacts = useSessionFilteredArtifacts(artifacts);
  const normalizedArtifacts = useMemo(
    () => normalizeTaskArtifacts(filteredArtifacts),
    [filteredArtifacts],
  );
  const { previewable, compact } = useMemo(
    () => splitRecentArtifacts(normalizedArtifacts),
    [normalizedArtifacts],
  );
  const canBrowseByPath = useMemo(
    () => hasNestedArtifactPaths(normalizedArtifacts),
    [normalizedArtifacts],
  );
  const pathTree = useMemo(
    () => buildTaskArtifactTree(normalizedArtifacts),
    [normalizedArtifacts],
  );

  const [view, setView] = useState<PanelView>("recent");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [deleteTargetIds, setDeleteTargetIds] = useState<readonly string[] | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [freshArtifactIds, setFreshArtifactIds] = useState<ReadonlySet<string>>(new Set());
  const previousIdsRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!canBrowseByPath && view === "path") {
      setView("recent");
    }
  }, [canBrowseByPath, view]);

  useEffect(() => {
    const nextIds = new Set(normalizedArtifacts.map((artifact) => artifact.id));
    const previousIds = previousIdsRef.current;
    if (previousIds.size > 0) {
      const added = normalizedArtifacts
        .filter((artifact) => !previousIds.has(artifact.id))
        .map((artifact) => artifact.id);
      if (added.length > 0) {
        setFreshArtifactIds((prev) => {
          const next = new Set(prev);
          for (const id of added) next.add(id);
          return next;
        });
      }
    }
    previousIdsRef.current = nextIds;
    setFreshArtifactIds((prev) => new Set([...prev].filter((id) => nextIds.has(id))));
  }, [normalizedArtifacts]);

  const selectedArtifact = useMemo(
    () => normalizedArtifacts.find((artifact) => artifact.id === selectedFileId) ?? null,
    [normalizedArtifacts, selectedFileId],
  );

  const selectedArtifactUrl = useMemo(
    () => (selectedArtifact ? buildArtifactUrl(selectedArtifact, conversationId) : null),
    [selectedArtifact, conversationId],
  );

  const currentFolder = useMemo(
    () => findFolderNode(pathTree, currentPath) ?? pathTree,
    [pathTree, currentPath],
  );

  const performDelete = useCallback(async (ids: readonly string[]): Promise<boolean> => {
    if (!conversationId || ids.length === 0) return false;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/artifacts/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact_ids: ids }),
      });
      if (!response.ok) return false;

      useAppStore.getState().recordArtifactsDeleted(ids);
      setFreshArtifactIds((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      if (selectedFileId && ids.includes(selectedFileId)) setSelectedFileId(null);
      return true;
    } catch (error) {
      console.error("Failed to delete artifacts", error);
      return false;
    }
  }, [conversationId, selectedFileId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTargetIds?.length) return;
    const ok = await performDelete(deleteTargetIds);
    if (ok) setDeleteTargetIds(null);
  }, [deleteTargetIds, performDelete]);

  if (normalizedArtifacts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">{t("artifacts.noFiles")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("library.noArtifactsHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-y-auto bg-background px-3 py-3 sm:px-4">
        <div className="rounded-2xl border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <Layers3 className="h-3.5 w-3.5" />
                <span>{t("artifacts.recentOutputs")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {normalizedArtifacts.length === 1
                    ? t("artifacts.fileCount", { count: normalizedArtifacts.length })
                    : t("artifacts.filesCount", { count: normalizedArtifacts.length })}
                </span>
                {freshArtifactIds.size > 0 ? (
                  <span className="rounded-full bg-accent-emerald/12 px-2.5 py-1 text-xs font-medium text-accent-emerald">
                    {t("artifacts.newSinceOpen", { count: freshArtifactIds.size })}
                  </span>
                ) : null}
              </div>
            </div>
            {canBrowseByPath ? (
              <div className="inline-flex rounded-xl border border-border bg-background p-1">
                <button
                  type="button"
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm transition-colors",
                    view === "recent" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setView("recent")}
                >
                  {t("artifacts.recentOutputs")}
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm transition-colors",
                    view === "path" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setView("path")}
                >
                  {t("artifacts.browseByPath")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {view === "recent" ? (
          <div className="mt-4 space-y-5">
            {previewable.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>{t("artifacts.previewReady")}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {previewable.map((artifact) => (
                    <RecentArtifactCard
                      key={artifact.id}
                      artifact={artifact}
                      conversationId={conversationId}
                      canDelete={Boolean(conversationId)}
                      onPreview={(item) => setSelectedFileId(item.id)}
                      onDelete={(ids) => setDeleteTargetIds(ids)}
                      isFresh={freshArtifactIds.has(artifact.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {compact.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>{t("artifacts.otherOutputs")}</span>
                </div>
                <div className="space-y-2">
                  {compact.map((artifact) => (
                    <CompactArtifactRow
                      key={artifact.id}
                      artifact={artifact}
                      conversationId={conversationId}
                      canDelete={Boolean(conversationId)}
                      onPreview={(item) => setSelectedFileId(item.id)}
                      onDelete={(ids) => setDeleteTargetIds(ids)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <FolderBreadcrumbs currentPath={currentFolder.path || "/"} onSelectPath={setCurrentPath} />
            {currentFolder.subFolders.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {currentFolder.subFolders.map((folder) => (
                  <PathFolderButton key={folder.id} folder={folder} onOpen={setCurrentPath} />
                ))}
              </div>
            ) : null}
            {currentFolder.items.length > 0 ? (
              <div className="space-y-2">
                {currentFolder.items.map((item) => {
                  const artifact = normalizedArtifacts.find((entry) => entry.id === item.id);
                  if (!artifact) return null;
                  return (
                    <CompactArtifactRow
                      key={artifact.id}
                      artifact={artifact}
                      conversationId={conversationId}
                      canDelete={Boolean(conversationId)}
                      onPreview={(entry) => setSelectedFileId(entry.id)}
                      onDelete={(ids) => setDeleteTargetIds(ids)}
                    />
                  );
                })}
              </div>
            ) : null}
            {currentFolder.subFolders.length === 0 && currentFolder.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t("artifacts.folderEmpty")}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ArtifactPreviewDialog
        artifact={selectedArtifact}
        artifactUrl={selectedArtifactUrl}
        open={selectedArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedFileId(null);
        }}
        onRequestDelete={conversationId ? () => setDeleteTargetIds(selectedArtifact ? [selectedArtifact.id] : null) : undefined}
      />

      <AlertDialog open={Boolean(deleteTargetIds?.length)} onOpenChange={(open) => !open && setDeleteTargetIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("explorer.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("explorer.deleteConfirmDesc", { count: deleteTargetIds?.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("explorer.cancel")}</AlertDialogCancel>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {t("explorer.deleteConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
