"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import { useMemoryEntries } from "../hooks/use-memory-entries";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTimeFromIso } from "@/shared/lib/date-time";

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.1, ease: "easeOut" as const } },
};

function truncateValue(value: string, maxLen = 80): string {
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
}

export function MemoryTab() {
  const { t, locale } = useTranslation();
  const { items, loading, error, page, totalPages, loadPage, deleteEntry } =
    useMemoryEntries();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (entryId: string) => {
    setDeletingId(entryId);
    await deleteEntry(entryId);
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            {t("preferences.memory.title")}
          </h3>
        </div>
        <p className="text-caption text-muted-foreground">
          {t("preferences.memory.description")}
        </p>
      </div>

      {error && (
        <ErrorBanner
          message={error}
          variant="compact"
          onDismiss={() => loadPage(page)}
        />
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* Header */}
        <div className="hidden grid-cols-[180px_1fr_100px_100px_40px] gap-3 bg-secondary px-4 py-3 label-mono text-muted-foreground md:grid">
          <span>{t("preferences.memory.key")}</span>
          <span>{t("preferences.memory.value")}</span>
          <span>{t("preferences.memory.scope")}</span>
          <span className="text-right">{t("preferences.memory.lastUpdated")}</span>
          <span />
        </div>

        {/* Rows */}
        {loading && items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            <span className="inline-block h-4 w-24 skeleton-shimmer rounded" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("preferences.memory.noData")}
          </div>
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.02 } },
            }}
          >
            {items.map((entry) => {
              const scopeLabel = entry.scope === "global"
                ? t("preferences.memory.global")
                : t("preferences.memory.conversation");
              const updatedLabel = formatRelativeTimeFromIso(entry.updated_at, locale);
              return (
                <motion.div
                  key={entry.id}
                  variants={listItem}
                  className={cn(
                    "border-t border-border first:border-t-0 transition-colors duration-100 hover:bg-secondary",
                    "px-4 py-3 text-sm",
                  )}
                >
                  <div className="md:hidden">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <span
                        className="min-w-0 truncate font-mono text-caption font-medium text-foreground"
                        title={entry.key}
                      >
                        {entry.key}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t("explorer.delete")} ${entry.key}`}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={deletingId === entry.id}
                        onClick={() => handleDelete(entry.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p
                      className="mt-2 min-w-0 text-caption leading-relaxed text-muted-foreground"
                      title={entry.value}
                    >
                      {truncateValue(entry.value)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex w-fit items-center rounded-full px-1.5 py-0.5 text-micro font-medium",
                          entry.scope === "global"
                            ? "border border-border bg-muted text-foreground"
                            : "bg-secondary text-muted-foreground",
                        )}
                      >
                        {scopeLabel}
                      </span>
                      <span className="font-mono text-micro text-muted-foreground-dim">
                        {t("preferences.memory.lastUpdated")}: {updatedLabel}
                      </span>
                    </div>
                  </div>

                  <div className="hidden md:grid md:grid-cols-[180px_1fr_100px_100px_40px] md:items-center md:gap-3">
                    <span
                      className="min-w-0 truncate font-mono text-caption font-medium text-foreground"
                      title={entry.key}
                    >
                      {entry.key}
                    </span>
                    <p
                      className="min-w-0 truncate text-caption leading-relaxed text-muted-foreground"
                      title={entry.value}
                    >
                      {truncateValue(entry.value)}
                    </p>
                    <span
                      className={cn(
                        "inline-flex w-fit items-center rounded-full px-1.5 py-0.5 text-micro font-medium",
                        entry.scope === "global"
                          ? "border border-border bg-muted text-foreground"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {scopeLabel}
                    </span>
                    <span className="text-right text-caption text-muted-foreground">
                      {updatedLabel}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("explorer.delete")} ${entry.key}`}
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={deletingId === entry.id}
                      onClick={() => handleDelete(entry.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => loadPage(page - 1)}
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {t("preferences.memory.previous")}
          </Button>
          <span className="text-caption text-muted-foreground">
            {t("preferences.memory.page", {
              current: page + 1,
              total: totalPages,
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages - 1 || loading}
            onClick={() => loadPage(page + 1)}
          >
            {t("preferences.memory.next")}
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
