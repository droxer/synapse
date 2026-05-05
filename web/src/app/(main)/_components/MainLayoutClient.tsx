"use client";

import { Menu } from "lucide-react";
import { startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "@/shared/components/CommandPalette";
import { useConversationRouteSync } from "@/features/conversation/hooks/use-conversation-route-sync";
import { getConversationPath } from "@/features/conversation/lib/routes";
import { useIsMobile } from "@/shared/hooks/use-media-query";
import { useAppStore } from "@/shared/stores";
import { useTranslation } from "@/i18n";

interface MainLayoutClientProps {
  readonly children: React.ReactNode;
}

export function MainLayoutClient({ children }: MainLayoutClientProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const resetConversation = useAppStore((s) => s.resetConversation);
  const queuePendingNewTask = useAppStore((s) => s.queuePendingNewTask);
  const clearPendingNewTask = useAppStore((s) => s.clearPendingNewTask);
  const clearPendingConversationRoute = useAppStore(
    (s) => s.clearPendingConversationRoute,
  );
  const switchConversation = useAppStore((s) => s.switchConversation);
  const openSidebar = useAppStore((s) => s.openSidebar);
  useConversationRouteSync();

  const handleNewTask = (prompt: string) => {
    clearPendingNewTask();
    clearPendingConversationRoute();
    resetConversation();
    queuePendingNewTask({ prompt });
    if (pathname !== "/") {
      startTransition(() => {
        router.push("/");
      });
    }
  };

  const handleNavigateHome = () => {
    clearPendingNewTask();
    clearPendingConversationRoute();
    resetConversation();
    if (pathname !== "/") {
      startTransition(() => {
        router.push("/");
      });
    }
  };

  const handleOpenConversation = (conversationId: string) => {
    clearPendingNewTask();
    clearPendingConversationRoute();
    switchConversation(conversationId);
    startTransition(() => {
      router.push(getConversationPath(conversationId));
    });
  };

  return (
    <div className="flex h-dvh min-h-dvh w-full flex-col bg-background md:flex-row">
      <AppSidebar />

      {isMobile && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={openSidebar}
            aria-label={t("a11y.openNavigationMenu")}
            className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
        onOpenConversation={handleOpenConversation}
      />
    </div>
  );
}
