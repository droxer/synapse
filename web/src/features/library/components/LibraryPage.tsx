"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Library, LayoutGrid, List } from "lucide-react";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { ProductPageHeader, ProductSectionHeader } from "@/shared/components/ProductPage";
import { SearchInput } from "@/shared/components/SearchInput";
import { SegmentedControl } from "@/shared/components/SegmentedControl";
import { Button } from "@/shared/components/ui/button";
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
      <ProductPageHeader
        className="py-5"
        icon={<Library aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
        eyebrow={t("library.title")}
        title={t("library.title")}
        description={
          isLoading && !statsLine ? (
            <div className="h-3 w-40 skeleton-shimmer rounded" />
          ) : (
            statsLine ?? t("library.subtitle")
          )
        }
        actions={
          groups.length > 0 || filter ? (
            <SegmentedControl<ViewMode>
              ariaLabel={t("library.title")}
              value={viewMode}
              onValueChange={handleSetViewMode}
              options={[
                {
                  value: "grid",
                  label: t("library.viewGrid"),
                  icon: <LayoutGrid aria-hidden="true" className="h-4 w-4" />,
                },
                {
                  value: "list",
                  label: t("library.viewList"),
                  icon: <List aria-hidden="true" className="h-4 w-4" />,
                },
              ]}
            />
          ) : null
        }
      />

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

          {(groups.length > 0 || filter) ? (
            <ProductSectionHeader
              eyebrow={t("library.title")}
              description={statsLine ?? t("library.subtitle")}
              actions={
                <SearchInput
                  value={filter}
                  onChange={setFilter}
                  placeholder={t("library.filterPlaceholder")}
                  clearLabel={t("library.clearFilter")}
                />
              }
            />
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
