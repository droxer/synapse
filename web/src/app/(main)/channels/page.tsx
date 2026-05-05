"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { TelegramLinkCard } from "@/features/channels/components/TelegramLinkCard";
import { ChannelChatView } from "@/features/channels/components/ChannelChatView";
import { ChannelsOnboarding } from "@/features/channels/components/ChannelsOnboarding";
import { ChannelsListening } from "@/features/channels/components/ChannelsListening";
import { ChannelPageHeader } from "@/features/channels/components/ChannelPageHeader";
import { ChannelConversationList } from "@/features/channels/components/ChannelConversationList";
import { getProviderLabel } from "@/features/channels/components/ChannelProviderIcon";
import { getChannelStatus } from "@/features/channels/api/channel-api";
import type { ChannelConversation } from "@/features/channels/api/channel-api";
import { Button } from "@/shared/components/ui/button";
import { useIsMobile } from "@/shared/hooks/use-media-query";
import { useTranslation } from "@/i18n";
import {
  resolveSelectedConversation,
  resolveChannelsPane,
  shouldShowChannelsHeader,
} from "@/features/channels/lib/channels-page-state";


function PageSkeleton() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="h-14 w-14 rounded-lg skeleton-shimmer" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-3 w-32 skeleton-shimmer" />
          <div className="mx-auto h-2.5 w-48 skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<ChannelConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const selectedConversation = useMemo(
    () => resolveSelectedConversation(conversations, selectedConversationId),
    [conversations, selectedConversationId],
  );
  const pane = resolveChannelsPane({
    isMobile,
    mobileChatOpen,
    hasSelectedConversation: selectedConversation !== null,
  });
  const showChannelsHeader = shouldShowChannelsHeader(pane);

  const reloadChannelStatus = useCallback(async () => {
    const statusRes = await getChannelStatus();
    const telegramIsConfigured = statusRes.providers.telegram?.configured ?? false;

    setTelegramConfigured(telegramIsConfigured);
    if (!telegramIsConfigured) {
      setConversations([]);
      setConversationCount(0);
      setSelectedConversationId(null);
      setMobileChatOpen(false);
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
        setMobileChatOpen(false);
        return;
      }

      setConversations(nextConversations);
      setConversationCount(nextConversations.length);
      if (nextConversations.length === 0) {
        setMobileChatOpen(false);
      }
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
        setMobileChatOpen(false);
      }
    },
    [selectedConversationId],
  );

  useEffect(() => {
    if (mobileChatOpen && !selectedConversation) {
      setMobileChatOpen(false);
    }
  }, [mobileChatOpen, selectedConversation]);

  const handleSelectConversation = useCallback((conversation: ChannelConversation) => {
    setSelectedConversationId(conversation.conversation_id);
    if (isMobile) {
      setMobileChatOpen(true);
    }
  }, [isMobile]);

  const renderThreadList = () => (
    <aside className="flex w-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar-bg md:w-auto md:border-r md:border-border">
      <div className="px-4 py-3">
        <p className="label-mono text-muted-foreground">
          {t("channels.list.title")}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto md:max-h-none">
        <ChannelConversationList
          selectedConversationId={selectedConversation?.conversation_id ?? null}
          onSelect={handleSelectConversation}
          onDeleted={handleConversationDeleted}
          onCountChange={setConversationCount}
          onConversationsChange={handleConversationsChange}
          refreshToken={refreshToken}
        />
      </div>
    </aside>
  );

  function renderContent() {
    if (conversationCount === null) {
      return <PageSkeleton />;
    }
    if (!telegramConfigured && !selectedConversation) {
      return <ChannelsOnboarding onConfigureBot={() => setIsTelegramModalOpen(true)} />;
    }

    if (pane === "chat" && selectedConversation) {
      const providerLabel = getProviderLabel(selectedConversation.provider);

      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMobileChatOpen(false)}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("channels.mobile.backToThreads")}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {selectedConversation.display_name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {providerLabel}
              </p>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <ChannelChatView
              key={selectedConversation.conversation_id}
              conversation={selectedConversation}
              hideTopBar
            />
          </div>
        </div>
      );
    }

    if (pane === "thread_list") {
      return (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {renderThreadList()}
        </div>
      );
    }

    return (
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-1">
        {renderThreadList()}

        <div className="min-h-0 min-w-0 overflow-hidden">
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
      {showChannelsHeader && (
        <ChannelPageHeader
          telegramConfigured={telegramConfigured}
          onOpenSettings={() => setIsTelegramModalOpen(true)}
        />
      )}

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
