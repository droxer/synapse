"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/shared/components";
import { useAppStore } from "@/shared/stores";

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    conversationId,
    conversationHistory,
    sidebarCollapsed,
    sidebarWidth,
    toggleSidebar,
    setSidebarWidth,
    loadConversations,
    loadMore,
    searchQuery,
    setSearchQuery,
    deleteConversation,
    switchConversation,
    resetConversation,
  } = useAppStore();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Debounced search: reload conversations 300ms after searchQuery changes
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      loadConversations();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, loadConversations]);

  const handleNewConversation = () => {
    resetConversation();
    if (pathname !== "/") router.push("/");
  };

  const handleSelectConversation = (id: string) => {
    if (id === conversationId && pathname === "/") return;
    switchConversation(id);
    if (pathname !== "/") router.push("/");
  };

  return (
    <Sidebar
      taskHistory={conversationHistory}
      activeTaskId={conversationId}
      onNewTask={handleNewConversation}
      onSelectTask={handleSelectConversation}
      collapsed={sidebarCollapsed}
      width={sidebarWidth}
      onToggle={toggleSidebar}
      onWidthChange={setSidebarWidth}
      onLoadMore={loadMore}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onDeleteTask={deleteConversation}
    />
  );
}
