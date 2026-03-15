"use client";

import Image from "next/image";
import { Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import type { ConversationHistoryItem } from "@/shared/stores";

interface SidebarProps {
  taskHistory: readonly ConversationHistoryItem[];
  onNewTask: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

const STATUS_DOT_COLORS: Record<ConversationHistoryItem["status"], string> = {
  running: "bg-amber-500",
  complete: "bg-emerald-500",
  error: "bg-rose-500",
};

export function Sidebar({ taskHistory, onNewTask, collapsed = false, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-12" : "w-64",
      )}
    >
      {/* Header: logo + collapse toggle */}
      <div className={cn("flex items-center py-4", collapsed ? "justify-center px-2" : "justify-between px-4")}>
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="HiAgent logo"
            width={28}
            height={28}
            className="rounded-md shrink-0"
          />
          {!collapsed && (
            <span className="text-sm font-bold tracking-tight text-foreground whitespace-nowrap">
              HiAgent
            </span>
          )}
        </div>
        {!collapsed && onToggle && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            className="text-muted-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* New task button */}
      <div className={cn(collapsed ? "px-2 pb-2" : "px-3 pb-3")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onNewTask}
                variant="ghost"
                className="w-full border border-transparent hover:border-border"
                size="icon"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New task</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            onClick={onNewTask}
            variant="ghost"
            className="w-full justify-start gap-2 border border-transparent hover:border-border"
          >
            <Plus className="h-4 w-4" />
            New task
          </Button>
        )}
      </div>

      {/* Task list */}
      <div className={cn("flex flex-1 flex-col overflow-hidden", collapsed ? "px-2" : "px-3")}>
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 pb-2">
            {!collapsed && taskHistory.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No tasks yet.
              </p>
            )}
            {taskHistory.map((task) =>
              collapsed ? (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-center p-2 transition-colors duration-150 hover:bg-muted"
                    >
                      <div
                        className={cn(
                          "h-1 w-1 shrink-0 rounded-full",
                          STATUS_DOT_COLORS[task.status],
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{task.title}</TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={task.id}
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-muted"
                >
                  <div
                    className={cn(
                      "h-1 w-1 shrink-0 rounded-full",
                      STATUS_DOT_COLORS[task.status],
                    )}
                  />
                  <span className="flex-1 truncate text-sm text-foreground">
                    {task.title}
                  </span>
                </button>
              ),
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Footer: collapse/expand toggle only */}
      <div className="flex justify-center py-3">
        {onToggle && (
          collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggle}
                  className="text-muted-foreground"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggle}
              className="text-muted-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )
        )}
      </div>
    </aside>
  );
}
