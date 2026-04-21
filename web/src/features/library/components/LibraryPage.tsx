"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Library, LayoutGrid, List } from "lucide-react";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { SearchInput } from "@/shared/components/SearchInput";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { ArtifactExplorer } from "@/shared/components/ArtifactExplorer";
import { GRID_COLS_CLASS } from "@/shared/components/ArtifactExplorer/ExplorerFileList";
import { useTranslation } from "@/i18n";
import { useLibrary } from "../hooks/use-library";
import type { ViewMode } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function readStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem("library:viewMode");
    if (stored === "list" || stored === "grid") return stored;
  } catch {
    // localStorage unavailable (SSR, private browsing)
  }
  return "grid";
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GroupSkeleton() {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 pb-3 mb-4">
        <div className="h-4 w-48 skeleton-shimmer rounded" />
        <div className="flex-1" />
        <div className="h-4 w-14 skeleton-shimmer rounded" />
        <div className="h-4 w-16 skeleton-shimmer rounded" />
      </div>
      <div className={GRID_COLS_CLASS}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[172px] rounded-xl skeleton-shimmer" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LibraryPage() {
  const { t } = useTranslation();
  const { groups, isLoading, error, filter, setFilter, loadMore, hasMore, removeArtifactsById } =
    useLibrary();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const lastDismissedErrorRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    setViewMode(readStoredViewMode());
  }, []);

  useEffect(() => {
    if (error && error !== lastDismissedErrorRef.current) {
      setDismissedAt(null);
    }
  }, [error]);

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("library:viewMode", mode);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const stats = useMemo(() => {
    const totalFiles = groups.reduce((sum, g) => sum + g.artifacts.length, 0);
    const totalSize = groups.reduce(
      (sum, g) => sum + g.artifacts.reduce((s, a) => s + a.size, 0),
      0,
    );
    return { totalFiles, totalSize, totalConversations: groups.length };
  }, [groups]);

  const statsLine = useMemo(() => {
    if (stats.totalFiles === 0) return null;
    const filesLabel = t(
      stats.totalFiles === 1 ? "library.statsFile" : "library.statsFiles",
      { count: stats.totalFiles },
    );
    const convsLabel = t(
      stats.totalConversations === 1
        ? "library.statsConversation"
        : "library.statsConversations",
      { count: stats.totalConversations },
    );
    return `${filesLabel} · ${formatBytes(stats.totalSize)} · ${convsLabel}`;
  }, [stats, t]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <motion.div
        className="shrink-0 px-6 py-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="chip-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
                <Library aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="label-mono text-muted-foreground-dim">
                  {t("library.title")}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.9rem]">
                  {t("library.title")}
                </h1>
                {isLoading && !statsLine ? (
                  <div className="mt-2 h-3 w-40 skeleton-shimmer rounded" />
                ) : statsLine ? (
                  <p className="mt-1 text-sm text-muted-foreground">{statsLine}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">{t("library.subtitle")}</p>
                )}
              </div>
            </div>
            {(groups.length > 0 || filter) ? (
              <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  aria-label={t("library.viewGrid")}
                  aria-pressed={viewMode === "grid"}
                  onClick={() => handleSetViewMode("grid")}
                  className={cn(viewMode !== "grid" && "text-muted-foreground hover:text-foreground")}
                >
                  <LayoutGrid aria-hidden="true" className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  aria-label={t("library.viewList")}
                  aria-pressed={viewMode === "list"}
                  onClick={() => handleSetViewMode("list")}
                  className={cn(viewMode !== "list" && "text-muted-foreground hover:text-foreground")}
                >
                  <List aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
          {(groups.length > 0 || filter) ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={filter}
                onChange={setFilter}
                placeholder={t("library.filterPlaceholder")}
                clearLabel={t("library.clearFilter")}
              />
            </div>
          ) : null}
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 overflow-hidden">
          {/* Error */}
          {error && dismissedAt === null && (
            <ErrorBanner message={error} onDismiss={() => {
              lastDismissedErrorRef.current = error;
              setDismissedAt(Date.now());
            }} />
          )}

          {/* Loading state */}
          {isLoading && groups.length === 0 ? (
            <div className="space-y-6">
              <GroupSkeleton />
              <GroupSkeleton />
              <GroupSkeleton />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <ArtifactExplorer
                mode="page"
                groups={groups}
                viewMode={viewMode}
                onLibraryArtifactsRemoved={removeArtifactsById}
              />
            </div>
          )}

          {/* Load more */}
          {hasMore && !isLoading && (
            <div className="flex shrink-0 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore}>
                {t("library.loadMore")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
