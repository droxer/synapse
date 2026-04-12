"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { listChannelConversations, type ChannelConversation } from "../api/channel-api";
import { deleteConversation } from "@/shared/api/conversation-list-api";
import { useAppStore } from "@/shared/stores";
import { getProviderColor } from "./ChannelProviderIcon";

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(isoString).toLocaleDateString([], { month: "short", day: "numeric" });
}

interface ChannelConversationListProps {
  selectedConversationId: string | null;
  onSelect: (conversation: ChannelConversation) => void;
  onDeleted?: (conversationId: string) => void;
  onCountChange?: (count: number) => void;
}

export function ChannelConversationList({
  selectedConversationId,
  onSelect,
  onDeleted,
  onCountChange,
}: ChannelConversationListProps) {
  const [conversations, setConversations] = useState<ChannelConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setError(null);
      const data = await listChannelConversations();
      setConversations(data.conversations);
      onCountChange?.(data.conversations.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const handleDelete = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (deletingId) return;

    if (!confirm("Are you sure you want to delete this conversation? This action cannot be undone.")) {
      return;
    }

    try {
      setDeletingId(conversationId);
      await deleteConversation(conversationId);
      useAppStore.getState().bumpLibraryRefetch();
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.conversation_id !== conversationId);
        onCountChange?.(filtered.length);
        return filtered;
      });
      onDeleted?.(conversationId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete conversation");
    } finally {
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

  if (error) {
    return (
      <div className="m-2 flex flex-col items-center gap-3 rounded-lg border border-destructive bg-destructive/5 px-4 py-8 text-center">
        <p className="text-xs text-destructive">{error}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); void fetchConversations(); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="mx-2 mt-1 rounded-md border border-dashed border-border bg-secondary px-3 py-4 text-center">
        <p className="text-xs font-medium text-muted-foreground">No conversations yet</p>
        <p className="mt-0.5 text-micro text-muted-foreground-dim leading-normal">
          Messages arrive automatically
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
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-0.5 px-2 py-1.5"
    >
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
                ? "bg-muted text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-r-full before:bg-border-strong before:content-['']"
                : "text-foreground hover:bg-sidebar-hover",
              deletingId === conv.conversation_id && "opacity-50 pointer-events-none"
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(conv)}
              className="flex w-full flex-1 items-center gap-3 rounded-md px-2.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-sm font-semibold text-primary-foreground"
                  style={{
                    background: `linear-gradient(135deg, ${providerColor}cc, ${providerColor})`,
                  }}
                >
                  {initial}
                </div>
                {/* Provider Badge */}
                <div
                  className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-sidebar-bg"
                  style={{ background: providerColor }}
                />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-1.5">
                  <span className="truncate text-sm font-medium leading-tight text-foreground pr-6">
                    {name}
                  </span>
                  {conv.last_message_at && (
                    <span className="shrink-0 tabular-nums text-micro text-muted-foreground-dim font-medium transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                      {formatRelativeTime(conv.last_message_at)}
                    </span>
                  )}
                </div>
                {conv.last_message ? (
                  <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                    {conv.last_message}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground-dim italic leading-tight">
                    New conversation
                  </p>
                )}
              </div>

              {/* Active session dot */}
              {conv.session_active && (
                <div className="shrink-0 flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-[pulsingDotRing_2s_ease-out_infinite] rounded-full bg-accent-emerald opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-emerald" />
                  </span>
                </div>
              )}
            </button>

            {/* Actions (hover) */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => handleDelete(e, conv.conversation_id)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                title="Delete conversation"
                aria-label="Delete conversation"
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
  );
}
