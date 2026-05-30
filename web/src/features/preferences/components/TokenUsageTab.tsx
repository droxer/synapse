"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TabHeader } from "./TabHeader";
import { useUserTokenUsage, formatTokenCount } from "@/shared/hooks/use-token-usage";
import { useTranslation } from "@/i18n";
import { useConversationUsageList } from "../hooks/use-conversation-usage-list";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTimeFromIso } from "@/shared/lib/date-time";

const USAGE_GRID_STYLE = {
  gridTemplateColumns:
    "minmax(0,1fr) minmax(5.5rem,7.5rem) minmax(5.5rem,7.5rem) minmax(6.5rem,8.5rem) minmax(5.5rem,7rem)",
} as const;

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.1, ease: "easeOut" as const } },
};

export function TokenUsageTab() {
  const { t, locale } = useTranslation();
  const { usage } = useUserTokenUsage();
  const { items, loading, error, page, totalPages, loadPage } = useConversationUsageList();

  const total = usage
    ? usage.total_input_tokens + usage.total_output_tokens
    : 0;
  const inputPct = total > 0 && usage
    ? (usage.total_input_tokens / total) * 100
    : 0;
  const outputPct = total > 0 && usage
    ? (usage.total_output_tokens / total) * 100
    : 0;

  return (
    <div>
      <TabHeader
        eyebrow={t("preferences.tabs.tokenUsage")}
        title={t("preferences.usage.summary")}
        description={t("preferences.usage.description")}
      />

      <div className="rounded-lg border border-hairline-soft bg-card p-4">
        {usage ? (
          <div className="space-y-3">
            {/* Bar */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-soft">
              <div
                className="h-full bg-focus/40 transition-[width] duration-200 ease-out"
                style={{ width: `${inputPct}%` }}
              />
              <div
                className="h-full bg-accent-emerald transition-[width] duration-200 ease-out"
                style={{ width: `${outputPct}%` }}
              />
            </div>

            {/* Legend */}
            <div className="flex flex-col gap-2 text-caption font-mono tabular-nums sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-focus/40" />
                <span className="text-steel">{t("profile.inputTokens")}</span>
                <span className="font-medium text-ink-deep">
                  {formatTokenCount(usage.total_input_tokens)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent-emerald" />
                <span className="text-steel">{t("profile.outputTokens")}</span>
                <span className="font-medium text-ink-deep">
                  {formatTokenCount(usage.total_output_tokens)}
                </span>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-caption text-steel">
              <span>
                {usage.total_requests === 1
                  ? t("preferences.usage.totalModelResponses.one")
                  : t("preferences.usage.totalModelResponses.other", {
                      count: usage.total_requests,
                    })}
              </span>
              <span>{t("preferences.usage.conversations", { count: usage.conversation_count })}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-steel">{t("preferences.usage.noData")}</p>
        )}
      </div>

      {/* Per-conversation table */}
      <div className="mt-6">
        <h4 className="mb-3 text-body-sm-bold text-ink-deep">
          {t("preferences.usage.perConversation")}
        </h4>

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} variant="compact" onDismiss={() => loadPage(page)} />
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-hairline-soft">
          {/* Header */}
          <div
            className="hidden gap-3 bg-surface-soft px-4 py-3 label-mono text-steel md:grid"
            style={USAGE_GRID_STYLE}
          >
            <span>{t("preferences.usage.taskName")}</span>
            <span className="text-right">{t("profile.inputTokens")}</span>
            <span className="text-right">{t("profile.outputTokens")}</span>
            <span className="text-right leading-tight">
              {t("preferences.usage.modelResponses")}
            </span>
            <span className="text-right">{t("preferences.usage.lastActive")}</span>
          </div>

          {/* Rows */}
          {loading && items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-steel">
              <span className="inline-block h-4 w-24 skeleton-shimmer rounded" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-steel">
              {t("preferences.usage.noData")}
            </div>
          ) : (
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.02 } } }}
            >
              {items.map((item) => {
                const title = item.title?.trim()
                  ? item.title
                  : t("library.untitledTask");
                const titleTooltip = item.title?.trim()
                  ? item.title
                  : item.conversation_id;
                return (
                  <motion.div
                    key={item.conversation_id}
                    variants={listItem}
                    className={cn(
                      "border-t border-hairline-soft/60 first:border-t-0 transition-colors duration-100 hover:bg-surface-soft",
                      "px-4 py-3 text-sm md:grid md:items-center md:gap-3",
                    )}
                    style={USAGE_GRID_STYLE}
                  >
                    <span
                      className="block min-w-0 truncate text-sm font-medium text-ink-deep md:font-normal"
                      title={titleTooltip}
                    >
                      {title}
                    </span>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-caption tabular-nums text-steel sm:grid-cols-4 md:contents md:mt-0">
                      <span className="flex justify-between gap-2 md:block md:text-right">
                        <span className="text-stone md:hidden">{t("profile.inputTokens")}</span>
                        {formatTokenCount(item.input_tokens)}
                      </span>
                      <span className="flex justify-between gap-2 md:block md:text-right">
                        <span className="text-stone md:hidden">{t("profile.outputTokens")}</span>
                        {formatTokenCount(item.output_tokens)}
                      </span>
                      <span className="flex justify-between gap-2 md:block md:text-right">
                        <span className="text-stone md:hidden">{t("preferences.usage.modelResponses")}</span>
                        {item.request_count}
                      </span>
                      <span className="flex justify-between gap-2 font-sans md:block md:text-right">
                        <span className="text-stone md:hidden">{t("preferences.usage.lastActive")}</span>
                        {formatRelativeTimeFromIso(item.updated_at, locale)}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => loadPage(page - 1)}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              {t("preferences.usage.previous")}
            </Button>
            <span className="text-caption text-steel">
              {t("preferences.usage.page", { current: page + 1, total: totalPages })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => loadPage(page + 1)}
            >
              {t("preferences.usage.next")}
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
