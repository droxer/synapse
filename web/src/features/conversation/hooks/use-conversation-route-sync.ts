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

export interface ConversationRouteSyncPlan {
  readonly shouldResetConversation: boolean;
  readonly switchConversationId: string | null;
  readonly shouldResumeConversation: boolean;
  readonly shouldClearPendingRoute: boolean;
}

export function getConversationRouteSyncPlan(
  pathname: string,
  conversationId: string | null,
  isLiveConversation: boolean,
  pendingConversationRouteId: string | null,
): ConversationRouteSyncPlan {
  if (pathname === "/") {
    return {
      shouldResetConversation:
        conversationId !== null && conversationId !== pendingConversationRouteId,
      switchConversationId: null,
      shouldResumeConversation: false,
      shouldClearPendingRoute: false,
    };
  }

  const routeConversationId = getConversationIdFromPathname(pathname);
  if (!routeConversationId) {
    return {
      shouldResetConversation: false,
      switchConversationId: null,
      shouldResumeConversation: false,
      shouldClearPendingRoute: false,
    };
  }

  return {
    shouldResetConversation: false,
    switchConversationId:
      routeConversationId !== conversationId ? routeConversationId : null,
    shouldResumeConversation: !isLiveConversation,
    shouldClearPendingRoute: routeConversationId === pendingConversationRouteId,
  };
}

export function useConversationRouteSync() {
  const pathname = usePathname();
  const conversationId = useAppStore((state) => state.conversationId);
  const isLiveConversation = useAppStore((state) => state.isLiveConversation);
  const pendingConversationRouteId = useAppStore(
    (state) => state.pendingConversationRouteId,
  );
  const switchConversation = useAppStore((state) => state.switchConversation);
  const resumeConversation = useAppStore((state) => state.resumeConversation);
  const resetConversation = useAppStore((state) => state.resetConversation);
  const clearPendingConversationRoute = useAppStore(
    (state) => state.clearPendingConversationRoute,
  );

  useEffect(() => {
    const plan = getConversationRouteSyncPlan(
      pathname,
      conversationId,
      isLiveConversation,
      pendingConversationRouteId,
    );

    if (plan.shouldResetConversation) {
      resetConversation();
    }
    if (plan.switchConversationId !== null) {
      switchConversation(plan.switchConversationId);
    }
    if (plan.shouldResumeConversation) {
      resumeConversation();
    }
    if (plan.shouldClearPendingRoute) {
      clearPendingConversationRoute();
    }
  }, [
    pathname,
    conversationId,
    isLiveConversation,
    pendingConversationRouteId,
    switchConversation,
    resumeConversation,
    resetConversation,
    clearPendingConversationRoute,
  ]);
}
