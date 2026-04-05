"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import { useMemoryEntries } from "../hooks/use-memory-entries";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.1, ease: "easeOut" as const } },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateValue(value: string, maxLen = 80): string {
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
}

export function MemoryTab() {
  const { t } = useTranslation();
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
        <p className="text-xs text-muted-foreground">
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
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[180px_1fr_100px_100px_40px] gap-3 bg-secondary px-4 py-3 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
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
            {items.map((entry) => (
                <motion.div
                  key={entry.id}
                  variants={listItem}
                  className={cn(
                    "grid grid-cols-[180px_1fr_100px_100px_40px] items-center gap-3 px-4 py-3 text-sm",
                    "border-t border-border first:border-t-0",
                    "hover:bg-secondary transition-colors duration-100",
                  )}
                >
                <span
                  className="truncate font-mono text-xs font-medium text-foreground"
                  title={entry.key}
                >
                  {entry.key}
                </span>
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={entry.value}
                >
                  {truncateValue(entry.value)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full w-fit",
                    entry.scope === "global"
                      ? "border border-border bg-muted text-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {entry.scope === "global"
                    ? t("preferences.memory.global")
                    : t("preferences.memory.conversation")}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {formatRelativeTime(entry.updated_at)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  disabled={deletingId === entry.id}
                  onClick={() => handleDelete(entry.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </motion.div>
            ))}
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
          <span className="text-xs text-muted-foreground">
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
