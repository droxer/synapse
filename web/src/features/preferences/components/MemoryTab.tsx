"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { TabHeader } from "./TabHeader";
import { useTranslation } from "@/i18n";
import { useMemoryEntries } from "../hooks/use-memory-entries";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { Button } from "@/shared/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTimeFromIso } from "@/shared/lib/date-time";

const MEMORY_GRID =
  "md:grid md:grid-cols-[180px_minmax(0,1fr)_100px_100px_40px] md:items-center md:gap-3";

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.1, ease: "easeOut" as const } },
};

function truncateValue(value: string, maxLen = 80): string {
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
}

function ScopeChip({ scope, label }: { readonly scope: "global" | "conversation"; readonly label: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-micro font-medium",
        scope === "global"
          ? "border-cobalt/25 bg-cobalt/10 text-cobalt"
          : "border-hairline-soft bg-surface-soft text-steel",
      )}
    >
      {label}
    </span>
  );
}

function DeleteMemoryButton({
  entryKey,
  disabled,
  onConfirm,
  size = "desktop",
}: {
  readonly entryKey: string;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly size?: "desktop" | "mobile";
}) {
  const { t } = useTranslation();
  const dim = size === "mobile" ? "h-7 w-7" : "h-6 w-6";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${t("explorer.delete")} ${entryKey}`}
          className={cn(dim, "shrink-0 text-steel hover:bg-critical/10 hover:text-critical")}
          disabled={disabled}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("preferences.memory.confirmDeleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("preferences.memory.confirmDeleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-hairline-soft bg-surface-soft px-3 py-2">
          <p className="font-mono text-caption text-ink-deep break-all">{entryKey}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("explorer.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-critical text-white hover:bg-critical/90"
          >
            {t("explorer.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
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
    <div>
      <TabHeader
        eyebrow={t("preferences.tabs.memory")}
        title={t("preferences.memory.title")}
        description={t("preferences.memory.description")}
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner
            message={error}
            variant="compact"
            onDismiss={() => loadPage(page)}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-hairline-soft">
        <div className="hidden grid-cols-[180px_minmax(0,1fr)_100px_100px_40px] gap-3 bg-surface-soft px-4 py-3 label-mono text-steel md:grid">
          <span>{t("preferences.memory.key")}</span>
          <span>{t("preferences.memory.value")}</span>
          <span>{t("preferences.memory.scope")}</span>
          <span className="text-right">{t("preferences.memory.lastUpdated")}</span>
          <span />
        </div>

        {loading && items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-steel">
            <span className="inline-block h-4 w-24 skeleton-shimmer rounded" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-steel">
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
                    "border-t border-hairline-soft/60 first:border-t-0 transition-colors duration-100 hover:bg-surface-soft",
                    "px-4 py-3 text-sm",
                  )}
                >
                  <div className="md:hidden">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <span
                        className="min-w-0 truncate font-mono text-caption font-medium text-ink-deep"
                        title={entry.key}
                      >
                        {entry.key}
                      </span>
                      <DeleteMemoryButton
                        entryKey={entry.key}
                        disabled={deletingId === entry.id}
                        onConfirm={() => handleDelete(entry.id)}
                        size="mobile"
                      />
                    </div>
                    <p
                      className="mt-2 min-w-0 text-caption leading-relaxed text-steel"
                      title={entry.value}
                    >
                      {truncateValue(entry.value)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ScopeChip scope={entry.scope} label={scopeLabel} />
                      <span className="font-mono text-micro text-stone">
                        {t("preferences.memory.lastUpdated")}: {updatedLabel}
                      </span>
                    </div>
                  </div>

                  <div className={cn("hidden", MEMORY_GRID)}>
                    <span
                      className="min-w-0 truncate font-mono text-caption font-medium text-ink-deep"
                      title={entry.key}
                    >
                      {entry.key}
                    </span>
                    <p
                      className="min-w-0 truncate text-caption leading-relaxed text-steel"
                      title={entry.value}
                    >
                      {truncateValue(entry.value)}
                    </p>
                    <ScopeChip scope={entry.scope} label={scopeLabel} />
                    <span className="text-right text-caption text-steel">
                      {updatedLabel}
                    </span>
                    <DeleteMemoryButton
                      entryKey={entry.key}
                      disabled={deletingId === entry.id}
                      onConfirm={() => handleDelete(entry.id)}
                    />
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => loadPage(page - 1)}
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {t("preferences.memory.previous")}
          </Button>
          <span className="text-caption text-steel">
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
