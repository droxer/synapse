export function shouldConnectConversationEvents(
  conversationId: string | null,
  isLive: boolean,
  isLoadingHistory: boolean,
  pendingConversationRouteId: string | null,
): boolean {
  if (!conversationId || !isLive) {
    return false;
  }
  if (pendingConversationRouteId === conversationId) {
    return true;
  }
  return !isLoadingHistory;
}
