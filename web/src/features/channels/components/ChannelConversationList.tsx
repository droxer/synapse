"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { listChannelConversations, type ChannelConversation } from "../api/channel-api";
import { ChannelProviderIcon, getProviderColor } from "./ChannelProviderIcon";

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
}

export function ChannelConversationList({
  selectedConversationId,
  onSelect,
}: ChannelConversationListProps) {
  const [conversations, setConversations] = useState<ChannelConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setError(null);
      const data = await listChannelConversations();
      setConversations(data.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  if (loading) {
    return (
      <div className="space-y-1 px-2 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-36 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-xs text-destructive">{error}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); void fetchConversations(); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        {/* Empty state illustration */}
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-muted opacity-60" />
          <svg className="relative h-7 w-7 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No conversations yet</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Link your account above and send<br />a message to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-2 py-1.5">
      {conversations.map((conv) => {
        const isSelected = conv.conversation_id === selectedConversationId;
        const name = conv.display_name ?? conv.provider_chat_id;
        const initial = name.charAt(0).toUpperCase();
        const providerColor = getProviderColor(conv.provider);

        return (
          <button
            key={conv.conversation_id}
            type="button"
            onClick={() => onSelect(conv)}
            className={cn(
              "group flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-all duration-150",
              isSelected
                ? "bg-accent text-accent-foreground shadow-sm"
                : "text-foreground hover:bg-muted/70",
            )}
          >
            {/* Avatar with provider color accent */}
            <div className="relative shrink-0">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${providerColor}cc, ${providerColor})` }}
              >
                {initial}
              </div>
              {/* Provider icon badge */}
              <div
                className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card"
                style={{ background: providerColor }}
              >
                <ChannelProviderIcon provider={conv.provider} size="sm" className="scale-[0.55]" />
              </div>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn(
                  "truncate text-sm font-medium leading-tight",
                  isSelected ? "text-accent-foreground" : "text-foreground",
                )}>
                  {name}
                </span>
                {conv.last_message_at && (
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {formatRelativeTime(conv.last_message_at)}
                  </span>
                )}
              </div>
              {conv.last_message ? (
                <p className={cn(
                  "mt-0.5 truncate text-xs leading-tight",
                  isSelected ? "text-accent-foreground/70" : "text-muted-foreground",
                )}>
                  {conv.last_message}
                </p>
              ) : (
                <p className="mt-0.5 text-xs italic text-muted-foreground/50">
                  No messages yet
                </p>
              )}
            </div>

            {/* Active session dot */}
            {conv.session_active && (
              <div className="shrink-0">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-emerald opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-emerald" />
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
