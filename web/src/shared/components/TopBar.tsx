"use client";

import { LayoutGrid } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useTranslation } from "@/i18n";
import type { TaskState } from "@/shared/types";

interface TopBarProps {
  taskState: TaskState;
  isConnected: boolean;
  currentIteration: number;
  onNavigateHome?: () => void;
  taskTitle?: string;
}

export function TopBar({
  taskState,
  isConnected,
  currentIteration,
  onNavigateHome,
  taskTitle,
}: TopBarProps) {
  const { t } = useTranslation();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm">
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateHome}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          {t("topbar.brand")}
        </Button>
        {taskState !== "idle" && (
          <>
            <span className="text-xs text-muted-foreground-dim">/</span>
            <span className="text-xs text-muted-foreground">
              {taskTitle ?? (currentIteration > 0 ? t("topbar.taskStep", { step: currentIteration }) : t("topbar.task"))}
            </span>
          </>
        )}
        {isConnected && (
          <span className="ml-1.5 h-2 w-2 rounded-full bg-accent-emerald" aria-label={t("topbar.connected")} title={t("topbar.connected")} />
        )}
      </div>

      {/* Right: spacer */}
      <div />
    </header>
  );
}
