export function getConversationPath(conversationId: string): string {
  return `/c/${encodeURIComponent(conversationId)}`;
}
