"use client";

import { Sidebar } from "@/shared/components";
import { useConversationContext } from "../hooks/use-conversation-context";

export function ConversationSidebar() {
  const { conversationHistory, handleNewConversation, sidebarCollapsed, toggleSidebar } =
    useConversationContext();

  return (
    <Sidebar
      taskHistory={conversationHistory}
      onNewTask={handleNewConversation}
      collapsed={sidebarCollapsed}
      onToggle={toggleSidebar}
    />
  );
}
