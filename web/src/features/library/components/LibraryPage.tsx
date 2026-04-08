"use client";

import { useMemo, useState, useCallback } from "react";
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
      <div className="flex items-center gap-3 pb-3 border-b border-border mb-4">
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
  const { groups, isLoading, error, filter, setFilter, loadMore, hasMore } = useLibrary();
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);

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
        className="shrink-0 border-b border-border px-6 py-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Library aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t("library.title")}
              </h1>
              {isLoading && !statsLine ? (
                <div className="h-3 w-40 skeleton-shimmer rounded mt-1" />
              ) : statsLine ? (
                <p className="text-xs text-muted-foreground">{statsLine}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("library.subtitle")}</p>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 overflow-hidden">
          {/* Error */}
          {error && error !== dismissedError && (
            <ErrorBanner message={error} onDismiss={() => setDismissedError(error)} />
          )}

          {/* Filter bar */}
          {groups.length > 0 || filter ? (
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex-1" />
              <SearchInput
                value={filter}
                onChange={setFilter}
                placeholder={t("library.filterPlaceholder")}
                clearLabel={t("library.clearFilter")}
              />
              <div className="flex items-center gap-1 ml-1">
                <button
                  type="button"
                  aria-label={t("library.viewGrid")}
                  aria-pressed={viewMode === "grid"}
                  onClick={() => handleSetViewMode("grid")}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                    viewMode === "grid"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  )}
                >
                  <LayoutGrid aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={t("library.viewList")}
                  aria-pressed={viewMode === "list"}
                  onClick={() => handleSetViewMode("list")}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                    viewMode === "list"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  )}
                >
                  <List aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          {/* Loading state */}
          {isLoading && groups.length === 0 ? (
            <div className="space-y-6">
              <GroupSkeleton />
              <GroupSkeleton />
              <GroupSkeleton />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <ArtifactExplorer mode="page" groups={groups} viewMode={viewMode} />
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
