"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { listChannelConversations, type ChannelConversation } from "../api/channel-api";
import { deleteConversation } from "@/shared/api/conversation-list-api";
import { useAppStore } from "@/shared/stores";
import { getProviderColor } from "./ChannelProviderIcon";
import { useTranslation } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";

function formatRelativeTime(
  isoString: string | null,
  locale: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("channels.list.time.now");
  if (minutes < 60) return t("channels.list.time.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("channels.list.time.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("channels.list.time.days", { count: days });
  return new Date(isoString).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

interface ChannelConversationListProps {
  selectedConversationId: string | null;
  onSelect: (conversation: ChannelConversation) => void;
  onDeleted?: (conversationId: string) => void;
  onCountChange?: (count: number) => void;
  refreshToken?: number;
  onConversationsChange?: (conversations: ChannelConversation[]) => void;
}

export function ChannelConversationList({
  selectedConversationId,
  onSelect,
  onDeleted,
  onCountChange,
  refreshToken = 0,
  onConversationsChange,
}: ChannelConversationListProps) {
  const { locale, t } = useTranslation();
  const [conversations, setConversations] = useState<ChannelConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await listChannelConversations();
      setConversations(data.conversations);
      onCountChange?.(data.conversations.length);
      onConversationsChange?.(data.conversations);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("channels.list.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [onConversationsChange, onCountChange, t]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations, refreshToken]);

  const handleDeleteClick = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (deletingId) return;
    setPendingDeleteId(conversationId);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    try {
      setDeletingId(pendingDeleteId);
      setActionError(null);
      await deleteConversation(pendingDeleteId);
      useAppStore.getState().bumpLibraryRefetch();
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.conversation_id !== pendingDeleteId);
        onCountChange?.(filtered.length);
        onConversationsChange?.(filtered);
        return filtered;
      });
      onDeleted?.(pendingDeleteId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("channels.list.errorDelete"));
    } finally {
      setPendingDeleteId(null);
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-0.5 px-2 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-md px-2.5 py-2.5">
            <div className="h-9 w-9 shrink-0 rounded-lg skeleton-shimmer" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-20 skeleton-shimmer" />
              <div className="h-2.5 w-28 skeleton-shimmer" />
            </div>
            <div className="h-2 w-5 skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="m-2 flex flex-col items-center gap-3 rounded-lg border border-destructive bg-destructive/5 px-4 py-8 text-center">
        <p className="text-xs text-destructive">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchConversations();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <RefreshCw className="h-3 w-3" />
          {t("channels.list.retry")}
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="mx-2 mt-1 rounded-md border border-dashed border-border bg-secondary px-3 py-4 text-center">
        <p className="text-xs font-medium text-muted-foreground">{t("channels.list.emptyTitle")}</p>
        <p className="mt-0.5 text-micro leading-normal text-muted-foreground-dim">
          {t("channels.list.emptyHint")}
        </p>
      </div>
    );
  }

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.02, delayChildren: 0.05 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, x: -6 },
    show: { opacity: 1, x: 0, transition: { duration: 0.15, ease: "easeOut" } },
  };

  return (
    <>
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-0.5 px-2 py-1.5"
      >
        {actionError && (
          <div className="mx-0.5 mb-2 rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        )}

        {conversations.map((conv) => {
          const isSelected = conv.conversation_id === selectedConversationId;
          const name = conv.display_name ?? conv.provider_chat_id;
          const initial = name.charAt(0).toUpperCase();
          const providerColor = getProviderColor(conv.provider);

          return (
            <motion.div
              key={conv.conversation_id}
              variants={item}
              className={cn(
                "group relative flex w-full items-center rounded-md text-left transition-colors duration-150",
                isSelected
                  ? "bg-muted text-foreground before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-r-full before:bg-border-strong before:content-['']"
                  : "text-foreground hover:bg-sidebar-hover",
                deletingId === conv.conversation_id && "pointer-events-none opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(conv)}
                className="flex w-full flex-1 items-center gap-3 rounded-md px-2.5 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <div className="relative shrink-0">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-sm font-semibold text-primary-foreground"
                    style={{ background: `linear-gradient(135deg, ${providerColor}cc, ${providerColor})` }}
                  >
                    {initial}
                  </div>
                  <div
                    className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border border-sidebar-bg"
                    style={{ background: providerColor }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1.5">
                    <span className="truncate pr-6 text-sm font-medium leading-tight text-foreground">
                      {name}
                    </span>
                    {conv.last_message_at && (
                      <span className="shrink-0 font-medium tabular-nums text-micro text-muted-foreground-dim transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                        {formatRelativeTime(conv.last_message_at, locale, t)}
                      </span>
                    )}
                  </div>
                  {conv.last_message ? (
                    <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                      {conv.last_message}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs italic leading-tight text-muted-foreground-dim">
                      {t("channels.list.newConversation")}
                    </p>
                  )}
                </div>

                {conv.session_active && (
                  <div className="flex shrink-0 items-center justify-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                    <span className="inline-flex h-2 w-2 rounded-full bg-accent-emerald" />
                  </div>
                )}
              </button>

              <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={(e) => handleDeleteClick(e, conv.conversation_id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  title={t("channels.list.deleteConversation")}
                  aria-label={t("channels.list.deleteConversation")}
                >
                  {deletingId === conv.conversation_id ? (
                    <Trash2 className="h-3.5 w-3.5 animate-pulse text-destructive" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("channels.list.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("channels.list.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("channels.list.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
              {t("channels.list.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
