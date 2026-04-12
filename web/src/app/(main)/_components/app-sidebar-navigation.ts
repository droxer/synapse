import { getConversationPath } from "@/features/conversation/lib/routes";

export interface RecentTaskNavigationDecision {
  readonly nextPath: string;
  readonly isAlreadyActive: boolean;
}

export function getRecentTaskNavigationDecision(
  currentConversationId: string | null,
  pathname: string,
  nextConversationId: string,
): RecentTaskNavigationDecision {
  const nextPath = getConversationPath(nextConversationId);
  return {
    nextPath,
    isAlreadyActive:
      currentConversationId === nextConversationId && pathname === nextPath,
  };
}
