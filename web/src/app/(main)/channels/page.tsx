"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { TelegramLinkCard } from "@/features/channels/components/TelegramLinkCard";
import { ChannelConversationList } from "@/features/channels/components/ChannelConversationList";
import { ChannelChatView } from "@/features/channels/components/ChannelChatView";
import { ChannelProviderIcon } from "@/features/channels/components/ChannelProviderIcon";
import type { ChannelConversation } from "@/features/channels/api/channel-api";


function ChannelsEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 py-12 text-center">
      {/* Icon cluster */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-3xl bg-muted/60" />
        <div className="relative flex h-10 w-10 items-center justify-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
        </div>
        {/* Floating provider dots */}
        <div className="absolute -right-1 -top-1">
          <ChannelProviderIcon provider="telegram" size="sm" />
        </div>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Choose a conversation from the list on the left, or link a new messaging account to get started.
        </p>
      </div>

      {/* Provider availability overview */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {["telegram", "whatsapp", "discord", "slack"].map((p) => (
          <div
            key={p}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 shadow-[var(--shadow-card)]"
          >
            <ChannelProviderIcon provider={p} size="sm" />
            <span className="text-xs font-medium capitalize text-muted-foreground">{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  const [configOpen, setConfigOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ChannelConversation | null>(null);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ── Left panel ── */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar-bg">

        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-purple/10">
              <svg className="h-3.5 w-3.5 text-accent-purple" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-foreground">Channels</h2>
          </div>
        </div>

        {/* Connected channels section */}
        <div className="border-b border-border">
          <button
            type="button"
            onClick={() => setConfigOpen((prev) => !prev)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-sidebar-hover/50"
          >
            <div className="flex items-center gap-2">
              {configOpen
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              }
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Connected
              </span>
            </div>
            <div className="flex items-center gap-1">
              <ChannelProviderIcon provider="telegram" size="sm" />
            </div>
          </button>

          {configOpen && (
            <div className="px-3 pb-3 animate-[fadeIn_0.15s_ease-out]">
              <TelegramLinkCard />
            </div>
          )}
        </div>

        {/* Conversations list */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conversations
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ChannelConversationList
              selectedConversationId={selectedConversation?.conversation_id ?? null}
              onSelect={setSelectedConversation}
            />
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedConversation ? (
          <ChannelChatView
            key={selectedConversation.conversation_id}
            conversation={selectedConversation}
          />
        ) : (
          <ChannelsEmptyState />
        )}
      </div>
    </div>
  );
}
