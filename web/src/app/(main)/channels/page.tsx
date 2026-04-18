"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TelegramLinkCard } from "@/features/channels/components/TelegramLinkCard";
import { ChannelChatView } from "@/features/channels/components/ChannelChatView";
import { ChannelsOnboarding } from "@/features/channels/components/ChannelsOnboarding";
import { ChannelsListening } from "@/features/channels/components/ChannelsListening";
import { ChannelPageHeader } from "@/features/channels/components/ChannelPageHeader";
import { ChannelConversationList } from "@/features/channels/components/ChannelConversationList";
import { getChannelStatus } from "@/features/channels/api/channel-api";
import type { ChannelConversation } from "@/features/channels/api/channel-api";
import {
  resolveSelectedConversation,
} from "@/features/channels/lib/channels-page-state";


function PageSkeleton() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="h-14 w-14 rounded-2xl skeleton-shimmer" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-3 w-32 skeleton-shimmer" />
          <div className="mx-auto h-2.5 w-48 skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  const [conversations, setConversations] = useState<ChannelConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const selectedConversation = useMemo(
    () => resolveSelectedConversation(conversations, selectedConversationId),
    [conversations, selectedConversationId],
  );

  const reloadChannelStatus = useCallback(async () => {
    const statusRes = await getChannelStatus();
    const telegramIsConfigured = statusRes.providers.telegram?.configured ?? false;

    setTelegramConfigured(telegramIsConfigured);
    if (!telegramIsConfigured) {
      setConversations([]);
      setConversationCount(0);
      setSelectedConversationId(null);
    } else {
      // Allow the split view to render immediately; the list component
      // will populate the actual conversation count.
      setConversationCount((current) => current ?? 0);
    }
    setError(null);
  }, []);

  useEffect(() => {
    void reloadChannelStatus().then(() => {
      setError(null);
    }).catch((err) => {
      setConversations([]);
      setConversationCount(0);
      setError(err instanceof Error ? err.message : "Failed to load channels");
    });
  }, [reloadChannelStatus]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshToken((current) => current + 1);
    }, 5000);

    const handleVisibility = () => {
      if (!document.hidden) {
        setRefreshToken((current) => current + 1);
      }
    };

    const handleFocus = () => {
      setRefreshToken((current) => current + 1);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  function handleModalChange(val: boolean) {
    setIsTelegramModalOpen(val);
    if (!val) {
      void reloadChannelStatus()
        .then(() => {
          setRefreshToken((current) => current + 1);
        })
        .catch(() => {});
    }
  }

  const handleConversationsChange = useCallback(
    (nextConversations: ChannelConversation[]) => {
      if (!telegramConfigured) {
        setConversations([]);
        setConversationCount(0);
        setSelectedConversationId(null);
        return;
      }

      setConversations(nextConversations);
      setConversationCount(nextConversations.length);
      setSelectedConversationId((current) =>
        resolveSelectedConversation(nextConversations, current)?.conversation_id ?? null,
      );
      setError(null);
    },
    [telegramConfigured],
  );

  const handleConversationDeleted = useCallback(
    (conversationId: string) => {
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null);
      }
    },
    [selectedConversationId],
  );

  function renderContent() {
    if (conversationCount === null) {
      return <PageSkeleton />;
    }
    if (!telegramConfigured && !selectedConversation) {
      return <ChannelsOnboarding onConfigureBot={() => setIsTelegramModalOpen(true)} />;
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-sidebar/40 md:w-[320px] md:border-b-0 md:border-r">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Telegram Threads
            </p>
          </div>
          <div className="max-h-64 min-h-0 flex-1 overflow-y-auto md:max-h-none">
            <ChannelConversationList
              selectedConversationId={selectedConversation?.conversation_id ?? null}
              onSelect={(conversation) => setSelectedConversationId(conversation.conversation_id)}
              onDeleted={handleConversationDeleted}
              onCountChange={setConversationCount}
              onConversationsChange={handleConversationsChange}
              refreshToken={refreshToken}
            />
          </div>
        </aside>

        <div className="min-h-0 flex-1">
          {selectedConversation ? (
            <ChannelChatView
              key={selectedConversation.conversation_id}
              conversation={selectedConversation}
              hideTopBar
            />
          ) : (
            <ChannelsListening />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ChannelPageHeader
        telegramConfigured={telegramConfigured}
        onOpenSettings={() => setIsTelegramModalOpen(true)}
      />

      {/* Modal-only: card is hidden, triggered from the header settings button */}
      <TelegramLinkCard
        hideCard
        open={isTelegramModalOpen}
        onOpenChange={handleModalChange}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {error && (
          <div className="mx-4 mt-4 rounded-lg border border-destructive bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}
        {renderContent()}
      </div>
    </div>
  );
}
