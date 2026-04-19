"use client";

import { startTransition, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/shared/components";
import { MobileDrawer } from "@/shared/components/MobileDrawer";
import { UserMenu } from "@/shared/components/UserMenu";
import { useAppStore } from "@/shared/stores";
import { useIsMobile } from "@/shared/hooks/use-media-query";
import { getRecentTaskNavigationDecision } from "./app-sidebar-navigation";

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();
  const isMobile = useIsMobile();
  const conversationId = useAppStore((s) => s.conversationId);
  const conversationHistory = useAppStore((s) => s.conversationHistory);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const closeSidebar = useAppStore((s) => s.closeSidebar);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const loadMore = useAppStore((s) => s.loadMore);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const switchConversation = useAppStore((s) => s.switchConversation);
  const resetConversation = useAppStore((s) => s.resetConversation);
  const clearPendingNewTask = useAppStore((s) => s.clearPendingNewTask);
  const clearPendingConversationRoute = useAppStore(
    (s) => s.clearPendingConversationRoute,
  );

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    loadConversations();
  }, [loadConversations, status]);

  useEffect(() => {
    const refresh = () => {
      if (status !== "authenticated") {
        return;
      }
      loadConversations();
    };
    const onVisibilityChange = () => {
      if (
        status === "authenticated" &&
        document.visibilityState === "visible"
      ) {
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadConversations, status]);

  const handleNewConversation = useCallback(() => {
    clearPendingNewTask();
    clearPendingConversationRoute();
    resetConversation();
    closeSidebar();
    if (pathname !== "/") {
      startTransition(() => {
        router.push("/");
      });
    }
  }, [
    clearPendingConversationRoute,
    clearPendingNewTask,
    resetConversation,
    closeSidebar,
    pathname,
    router,
  ]);

  const handleSelectConversation = useCallback((id: string) => {
    const decision = getRecentTaskNavigationDecision(conversationId, pathname, id);
    if (decision.isAlreadyActive) {
      closeSidebar();
      return;
    }
    clearPendingNewTask();
    clearPendingConversationRoute();
    switchConversation(id);
    closeSidebar();
    if (pathname !== decision.nextPath) {
      startTransition(() => {
        router.push(decision.nextPath);
      });
    }
  }, [
    clearPendingConversationRoute,
    clearPendingNewTask,
    conversationId,
    pathname,
    switchConversation,
    closeSidebar,
    router,
  ]);

  const handleSidebarNavigate = useCallback((href: string) => {
    closeSidebar();
    if (pathname !== href) {
      router.push(href);
    }
  }, [closeSidebar, pathname, router]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    const isActiveRoute =
      conversationId === id && pathname === getRecentTaskNavigationDecision(conversationId, pathname, id).nextPath;

    if (isActiveRoute) {
      clearPendingNewTask();
      clearPendingConversationRoute();
      resetConversation();
      closeSidebar();
      startTransition(() => {
        router.push("/");
      });
    }

    await deleteConversation(id);
  }, [
    clearPendingConversationRoute,
    clearPendingNewTask,
    closeSidebar,
    conversationId,
    deleteConversation,
    pathname,
    resetConversation,
    router,
  ]);

  const isCollapsed = isMobile ? false : sidebarCollapsed;

  const sidebar = (
    <Sidebar
      taskHistory={conversationHistory}
      activeTaskId={conversationId}
      onNewTask={handleNewConversation}
      onSelectTask={handleSelectConversation}
      onNavigate={handleSidebarNavigate}
      collapsed={isCollapsed}
      width={isMobile ? 256 : sidebarWidth}
      onToggle={isMobile ? undefined : toggleSidebar}
      onWidthChange={isMobile ? undefined : setSidebarWidth}
      onLoadMore={loadMore}
      onDeleteTask={handleDeleteConversation}
      onClose={isMobile ? closeSidebar : undefined}
      isMobile={isMobile}
      activePath={pathname}
      userMenu={<UserMenu collapsed={isCollapsed} />}
    />
  );

  if (isMobile) {
    return (
      <MobileDrawer open={sidebarOpen} onClose={closeSidebar}>
        {sidebar}
      </MobileDrawer>
    );
  }

  return sidebar;
}
