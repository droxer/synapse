"use client";

import { LayoutGrid } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { TaskState } from "@/shared/types";

interface TopBarProps {
  taskState: TaskState;
  isConnected: boolean;
  currentIteration: number;
  onNavigateHome?: () => void;
}

export function TopBar({ taskState, isConnected, currentIteration, onNavigateHome }: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-sm">
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateHome}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          HiAgent
        </Button>
        {taskState !== "idle" && (
          <>
            <span className="text-xs text-border-strong">/</span>
            <span className="text-xs text-muted-foreground">
              Task {currentIteration > 0 ? `(Step ${currentIteration})` : ""}
            </span>
          </>
        )}
        {isConnected && (
          <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )}
      </div>
    </header>
  );
}
