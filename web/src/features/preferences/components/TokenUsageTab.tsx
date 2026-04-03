"use client";

import { motion } from "framer-motion";
import { Zap, ChevronLeft, ChevronRight } from "lucide-react";
import { useUserTokenUsage, formatTokenCount } from "@/shared/hooks/use-token-usage";
import { useTranslation } from "@/i18n";
import { useConversationUsageList } from "../hooks/use-conversation-usage-list";
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

function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function TokenUsageTab() {
  const { t } = useTranslation();
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
    <div className="space-y-6">
      {/* Aggregate summary */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-accent-purple" />
          <h3 className="text-sm font-semibold text-foreground">
            {t("preferences.usage.summary")}
          </h3>
        </div>

        {usage ? (
          <div className="space-y-3">
            {/* Bar */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-accent-purple/40 transition-[width] duration-500 ease-out"
                style={{ width: `${inputPct}%` }}
              />
              <div
                className="h-full bg-accent-purple transition-[width] duration-500 ease-out"
                style={{ width: `${outputPct}%` }}
              />
            </div>

            {/* Legend */}
            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent-purple/40" />
                <span className="text-muted-foreground">{t("profile.inputTokens")}</span>
                <span className="font-medium text-foreground">
                  {formatTokenCount(usage.total_input_tokens)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent-purple" />
                <span className="text-muted-foreground">{t("profile.outputTokens")}</span>
                <span className="font-medium text-foreground">
                  {formatTokenCount(usage.total_output_tokens)}
                </span>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
              <span>{t("profile.totalRequests", { count: usage.total_requests })}</span>
              <span>{t("preferences.usage.conversations", { count: usage.conversation_count })}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("preferences.usage.noData")}</p>
        )}
      </div>

      {/* Per-conversation table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          {t("preferences.usage.perConversation")}
        </h3>

        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} variant="compact" onDismiss={() => loadPage(page)} />
          </div>
        )}

        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_120px_120px_80px_120px] gap-3 bg-secondary/50 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>{t("preferences.usage.conversationId")}</span>
            <span className="text-right">{t("profile.inputTokens")}</span>
            <span className="text-right">{t("profile.outputTokens")}</span>
            <span className="text-right">{t("preferences.usage.requests")}</span>
            <span className="text-right">{t("preferences.usage.lastActive")}</span>
          </div>

          {/* Rows */}
          {loading && items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              <span className="inline-block h-4 w-24 skeleton-shimmer rounded" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("preferences.usage.noData")}
            </div>
          ) : (
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.02 } } }}
            >
              {items.map((item) => (
                <motion.div
                  key={item.conversation_id}
                  variants={listItem}
                  className={cn(
                    "grid grid-cols-[1fr_120px_120px_80px_120px] items-center gap-3 px-4 py-3 text-sm",
                    "border-t border-border first:border-t-0",
                    "hover:bg-secondary/30 transition-colors duration-100",
                  )}
                >
                  <span className="truncate font-mono text-xs text-foreground">
                    {truncateId(item.conversation_id)}
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatTokenCount(item.input_tokens)}
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatTokenCount(item.output_tokens)}
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {item.request_count}
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    {formatRelativeTime(item.updated_at)}
                  </span>
                </motion.div>
              ))}
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
            <span className="text-xs text-muted-foreground">
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
