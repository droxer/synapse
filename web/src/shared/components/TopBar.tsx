"use client";

import { useCallback } from "react";
import { LayoutGrid, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useTranslation } from "@/i18n";
import type { TaskState } from "@/shared/types";

interface TopBarProps {
  taskState: TaskState;
  isConnected: boolean;
  onNavigateHome?: () => void;
  conversationTitle?: string;
}

export function TopBar({
  taskState,
  isConnected,
  onNavigateHome,
  conversationTitle,
}: TopBarProps) {
  const { t } = useTranslation();

  const handleOpenCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
  }, []);

  const isActive = taskState !== "idle";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateHome}
          className="shrink-0 gap-2 text-muted-foreground hover:text-foreground"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        {isActive && conversationTitle && (
          <>
            <span className="text-[13px] text-muted-foreground-dim">/</span>
            <span className="truncate text-[13px] font-medium text-foreground">
              {conversationTitle}
            </span>
          </>
        )}
        {isConnected && (
          <span className="ml-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-emerald" aria-label={t("topbar.connected")} title={t("topbar.connected")} />
        )}
      </div>

      {/* Right: Command palette trigger */}
      <button
        type="button"
        onClick={handleOpenCommandPalette}
        className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search className="h-3 w-3" />
        <span>{t("topbar.search")}</span>
        <kbd className="font-mono text-micro text-muted-foreground-dim">⌘K</kbd>
      </button>
    </header>
  );
}
