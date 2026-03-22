"use client";

import { motion } from "framer-motion";
import { FolderOpen, Search } from "lucide-react";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { SearchInput } from "@/shared/components/SearchInput";
import { Button } from "@/shared/components/ui/button";
import { listContainer, listItem } from "@/shared/lib/animations";
import { useTranslation } from "@/i18n";
import { useLibrary } from "../hooks/use-library";
import { useViewMode } from "../hooks/use-view-mode";
import { ConversationGroup } from "./ConversationGroup";
import { ViewModeToggle } from "./ViewModeToggle";

function GroupSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="h-4 w-4 skeleton-shimmer rounded" />
        <div className="h-4 w-48 skeleton-shimmer rounded" />
        <div className="flex-1" />
        <div className="h-4 w-20 skeleton-shimmer rounded" />
      </div>
      <div className="ml-6 space-y-1.5">
        <div className="h-[58px] rounded-lg skeleton-shimmer" />
        <div className="h-[58px] rounded-lg skeleton-shimmer" />
      </div>
    </div>
  );
}

export function LibraryPage() {
  const { t } = useTranslation();
  const { groups, isLoading, error, filter, setFilter, loadMore, hasMore } =
    useLibrary();
  const { viewMode, setViewMode } = useViewMode();

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <motion.div
        className="shrink-0 border-b border-border px-6 py-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        <div className="mx-auto flex max-w-5xl items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                {t("library.title")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("library.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* Error */}
          {error && (
            <ErrorBanner message={error} onDismiss={() => {}} />
          )}

          {/* Filter bar */}
          {groups.length > 0 || filter ? (
            <div className="flex items-center gap-3">
              <h2 className="text-base font-medium text-muted-foreground">
                {t("library.title")}
              </h2>
              <div className="flex-1" />
              <SearchInput
                value={filter}
                onChange={setFilter}
                placeholder={t("library.filterPlaceholder")}
                clearLabel={t("library.clearFilter")}
              />
              <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
            </div>
          ) : null}

          {/* Loading state */}
          {isLoading && groups.length === 0 ? (
            <div className="space-y-6">
              <GroupSkeleton />
              <GroupSkeleton />
              <GroupSkeleton />
            </div>
          ) : groups.length === 0 && filter ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <EmptyState
                icon={Search}
                description={t("library.noMatching")}
                dashed
              />
            </motion.div>
          ) : groups.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12, delay: 0.05 }}
            >
              <EmptyState
                icon={FolderOpen}
                title={t("library.noArtifacts")}
                description={t("library.noArtifactsHint")}
                dashed
              />
            </motion.div>
          ) : (
            <motion.div
              className="space-y-4"
              variants={listContainer}
              initial="hidden"
              animate="show"
            >
              {groups.map((group) => (
                <motion.div key={group.conversation_id} variants={listItem}>
                  <ConversationGroup group={group} viewMode={viewMode} />
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Load more */}
          {hasMore && !isLoading && (
            <div className="flex justify-center pt-2">
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
