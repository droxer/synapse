"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/shared/components";
import { MobileDrawer } from "@/shared/components/MobileDrawer";
import { useAppStore } from "@/shared/stores";
import { useIsMobile } from "@/shared/hooks/use-media-query";

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
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

  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadConversations();
  }, [loadConversations]);

  const handleNewConversation = useCallback(() => {
    resetConversation();
    closeSidebar();
    if (pathname !== "/") router.push("/");
  }, [resetConversation, closeSidebar, pathname, router]);

  const handleSelectConversation = useCallback((id: string) => {
    if (id === conversationId && pathname === "/") return;
    switchConversation(id);
    closeSidebar();
    if (pathname !== "/") router.push("/");
  }, [conversationId, pathname, switchConversation, closeSidebar, router]);

  const sidebar = (
    <Sidebar
      taskHistory={conversationHistory}
      activeTaskId={conversationId}
      onNewTask={handleNewConversation}
      onSelectTask={handleSelectConversation}
      collapsed={isMobile ? false : sidebarCollapsed}
      width={isMobile ? 256 : sidebarWidth}
      onToggle={isMobile ? undefined : toggleSidebar}
      onWidthChange={isMobile ? undefined : setSidebarWidth}
      onLoadMore={loadMore}
      onDeleteTask={deleteConversation}
      onClose={isMobile ? closeSidebar : undefined}
      isMobile={isMobile}
      activePath={pathname}
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
