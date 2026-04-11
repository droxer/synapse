"use client";

import { Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { createConversation } from "@/features/conversation/api/conversation-api";
import { ConversationProvider } from "@/features/conversation/components/ConversationProvider";
import { useConversationRouteSync } from "@/features/conversation/hooks/use-conversation-route-sync";
import { useIsMobile } from "@/shared/hooks/use-media-query";
import { useAppStore } from "@/shared/stores";

interface MainLayoutClientProps {
  readonly children: React.ReactNode;
}

export function MainLayoutClient({ children }: MainLayoutClientProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const startConversation = useAppStore((s) => s.startConversation);
  const resetConversation = useAppStore((s) => s.resetConversation);
  const openSidebar = useAppStore((s) => s.openSidebar);
  useConversationRouteSync();

  const handleNewTask = async (prompt: string) => {
    try {
      const data = await createConversation(prompt);
      startConversation(data.conversation_id, prompt);
      router.push(`/c/${data.conversation_id}`);
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
  };

  const handleNavigateHome = () => {
    resetConversation();
    router.push("/");
  };

  return (
    <ConversationProvider>
      <div className="flex h-screen w-screen flex-col bg-background md:flex-row">
        <AppSidebar />

        {isMobile && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2 md:hidden">
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Open navigation menu"
              className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Synapse
            </span>
          </div>
        )}

        <main
          id="main"
          aria-label="Main content"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-hidden">{children}</div>
        </main>
        <CommandPalette
          onNewTask={handleNewTask}
          onNavigateHome={handleNavigateHome}
          onNavigateSkills={() => router.push("/skills")}
          onNavigateMcp={() => router.push("/mcp")}
        />
      </div>
    </ConversationProvider>
  );
}
