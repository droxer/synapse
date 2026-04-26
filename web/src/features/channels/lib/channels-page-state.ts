import type { ChannelConversation } from "../api/channel-api";

export type ChannelsPane = "split" | "thread_list" | "chat";

export function sortChannelConversations(
  conversations: readonly ChannelConversation[],
): ChannelConversation[] {
  return [...conversations].sort((a, b) => {
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bTime - aTime;
  });
}

export function resolveSelectedConversation(
  conversations: readonly ChannelConversation[],
  selectedConversationId: string | null,
): ChannelConversation | null {
  if (conversations.length === 0) {
    return null;
  }

  if (selectedConversationId) {
    const selected = conversations.find(
      (conversation) => conversation.conversation_id === selectedConversationId,
    );
    if (selected) {
      return selected;
    }
  }

  return conversations[0] ?? null;
}

export function resolveChannelsPane({
  isMobile,
  mobileChatOpen,
  hasSelectedConversation,
}: {
  readonly isMobile: boolean;
  readonly mobileChatOpen: boolean;
  readonly hasSelectedConversation: boolean;
}): ChannelsPane {
  if (!isMobile) {
    return "split";
  }

  return mobileChatOpen && hasSelectedConversation ? "chat" : "thread_list";
}

export function shouldShowChannelsHeader(pane: ChannelsPane): boolean {
  return pane !== "chat";
}
