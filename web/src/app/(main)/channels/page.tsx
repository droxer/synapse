"use client";

import { useEffect, useState } from "react";
import { TelegramLinkCard } from "@/features/channels/components/TelegramLinkCard";
import { ChannelChatView } from "@/features/channels/components/ChannelChatView";
import { ChannelsOnboarding } from "@/features/channels/components/ChannelsOnboarding";
import { ChannelsListening } from "@/features/channels/components/ChannelsListening";
import { ChannelPageHeader } from "@/features/channels/components/ChannelPageHeader";
import { getChannelStatus, listChannelConversations } from "@/features/channels/api/channel-api";
import type { ChannelConversation } from "@/features/channels/api/channel-api";


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
  const [autoConversation, setAutoConversation] = useState<ChannelConversation | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      getChannelStatus(),
      listChannelConversations(),
    ]).then(([statusRes, convsRes]) => {
      setTelegramConfigured(statusRes.providers.telegram?.configured ?? false);
      const sorted = [...convsRes.conversations].sort((a, b) => {
        const aT = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bT = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bT - aT;
      });
      setConversationCount(sorted.length);
      setAutoConversation(sorted[0] ?? null);
      setError(null);
    }).catch((err) => {
      setConversationCount(0);
      setError(err instanceof Error ? err.message : "Failed to load channels");
    });
  }, []);

  function handleModalChange(val: boolean) {
    setIsTelegramModalOpen(val);
    if (!val) {
      // Refresh status after modal closes
      void getChannelStatus().then((res) => {
        setTelegramConfigured(res.providers.telegram?.configured ?? false);
      }).catch(() => {});
    }
  }

  function renderContent() {
    if (conversationCount === null) {
      return <PageSkeleton />;
    }
    if (autoConversation) {
      return (
        <ChannelChatView
          key={autoConversation.conversation_id}
          conversation={autoConversation}
          hideTopBar
        />
      );
    }
    if (!telegramConfigured) {
      return <ChannelsOnboarding onConfigureBot={() => setIsTelegramModalOpen(true)} />;
    }
    return <ChannelsListening />;
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
