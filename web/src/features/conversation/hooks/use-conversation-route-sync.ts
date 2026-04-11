"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/shared/stores";

const CONVERSATION_ROUTE_PREFIX = "/c/";

export function getConversationIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith(CONVERSATION_ROUTE_PREFIX)) {
    return null;
  }
  const maybeId = pathname.slice(CONVERSATION_ROUTE_PREFIX.length).split("/")[0];
  return maybeId ? decodeURIComponent(maybeId) : null;
}

export function useConversationRouteSync() {
  const pathname = usePathname();
  const conversationId = useAppStore((state) => state.conversationId);
  const switchConversation = useAppStore((state) => state.switchConversation);
  const resumeConversation = useAppStore((state) => state.resumeConversation);
  const resetConversation = useAppStore((state) => state.resetConversation);

  useEffect(() => {
    if (pathname === "/") {
      if (conversationId !== null) {
        resetConversation();
      }
      return;
    }

    const routeConversationId = getConversationIdFromPathname(pathname);
    if (!routeConversationId) {
      return;
    }
    if (routeConversationId !== conversationId) {
      switchConversation(routeConversationId);
    }
    resumeConversation();
  }, [pathname, conversationId, switchConversation, resumeConversation, resetConversation]);
}
