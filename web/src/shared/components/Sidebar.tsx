"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus, PanelLeftClose, PanelLeftOpen, Trash2, Blocks, Lightbulb } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { LanguageSwitcher } from "@/shared/components/LanguageSwitcher";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import type { ConversationHistoryItem } from "@/shared/stores";

interface SidebarProps {
  taskHistory: readonly ConversationHistoryItem[];
  activeTaskId?: string | null;
  onNewTask: () => void;
  onSelectTask?: (taskId: string) => void;
  collapsed?: boolean;
  width?: number;
  onToggle?: () => void;
  onWidthChange?: (width: number) => void;
  onLoadMore?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
}


export function Sidebar({
  taskHistory,
  activeTaskId,
  onNewTask,
  onSelectTask,
  collapsed = false,
  width = 256,
  onToggle,
  onWidthChange,
  onLoadMore,
  onDeleteTask,
  onClose,
  isMobile = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const [taskToDelete, setTaskToDelete] = useState<ConversationHistoryItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      onWidthChange?.(dragStartWidth.current + delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onWidthChange]);

  // Infinite-scroll via native scroll listener on the task list container.
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMorePending = useRef(false);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      if (loadMorePending.current || !onLoadMoreRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      if (
        scrollHeight > clientHeight &&
        scrollHeight - scrollTop - clientHeight < 100
      ) {
        loadMorePending.current = true;
        Promise.resolve(onLoadMoreRef.current()).finally(() => {
          loadMorePending.current = false;
        });
      }
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (taskToDelete && onDeleteTask) {
      onDeleteTask(taskToDelete.id);
    }
    setTaskToDelete(null);
  }, [taskToDelete, onDeleteTask]);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setTaskToDelete(null);
  }, []);

  return (
    <aside
      className={cn(
        "relative flex h-screen shrink-0 flex-col overflow-hidden bg-sidebar-bg border-r border-border",
        collapsed ? "w-12" : "",
        !collapsed && !isDragging && "transition-[width] duration-200 ease-in-out",
      )}
      style={collapsed ? undefined : { width }}
    >
      {/* Header: logo + collapse/expand toggle */}
      <div className={cn("relative flex items-center py-4", collapsed ? "flex-col gap-2 px-2" : "justify-between px-4")}>
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt={t("sidebar.logo")}
            width={28}
            height={28}
            className="rounded-md shrink-0"
          />
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap">
              {t("sidebar.brand")}
            </span>
          )}
        </div>
        {onToggle && (
          collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={false} aria-label={t("sidebar.expand")} className="text-muted-foreground hover:text-foreground hover:bg-sidebar-hover">
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.expand")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={true} aria-label={t("sidebar.collapse")} className="text-muted-foreground hover:text-foreground hover:bg-sidebar-hover">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )
        )}
      </div>

      {/* New task + Skills + Integrations action bar */}
      <div className={cn("relative", collapsed ? "px-2 pb-2 space-y-1" : "px-4 pb-3")}>
        {collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onNewTask}
                  variant="ghost"
                  className="w-full border border-border hover:border-border-active hover:bg-secondary transition-all duration-200"
                  size="icon"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.newTask")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/skills">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="w-full text-muted-foreground hover:text-foreground hover:bg-secondary"
                    asChild
                  >
                    <span>
                      <Lightbulb className="h-4 w-4" />
                    </span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.skills")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/mcp">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="w-full text-muted-foreground hover:text-foreground hover:bg-secondary"
                    asChild
                  >
                    <span>
                      <Blocks className="h-4 w-4" />
                    </span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.mcp")}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <div className="space-y-1">
            <Button
              onClick={onNewTask}
              variant="outline"
              className="w-full justify-start gap-2 rounded-md border-border bg-secondary hover:border-border-active hover:bg-secondary"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              {t("sidebar.newTask")}
            </Button>
            <Link
              href="/skills"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Lightbulb className="h-4 w-4" />
              {t("sidebar.skills")}
            </Link>
            <Link
              href="/mcp"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Blocks className="h-4 w-4" />
              {t("sidebar.mcp")}
            </Link>
          </div>
        )}
      </div>

      {/* Task list */}
      {!collapsed && (
        <div className="px-4 pb-1.5 pt-1">
          <span className="text-xs font-medium text-muted-foreground-dim">{t("sidebar.recentTasks")}</span>
        </div>
      )}
      <div ref={scrollRef} className={cn("relative min-h-0 flex-1 overflow-y-auto", collapsed ? "px-2" : "px-4")}>
          <div className="space-y-1 pb-2">
            {!collapsed && taskHistory.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground-dim">
                {t("sidebar.noTasks")}
              </p>
            )}
            {taskHistory.map((task) => {
              const isActive = task.id === activeTaskId;
              return collapsed ? (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSelectTask?.(task.id)}
                      className={cn(
                        "relative flex w-full cursor-pointer items-center justify-center rounded-md p-2 transition-colors duration-200",
                        "hover:bg-secondary",
                        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        isActive && "bg-secondary",
                      )}
                    >
                      <div className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                        isActive ? "bg-accent-purple" : "bg-muted-foreground/30",
                      )} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{task.title}</TooltipContent>
                </Tooltip>
              ) : (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelectTask?.(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectTask?.(task.id);
                    }
                  }}
                  className={cn(
                    "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left",
                    "transition-colors duration-200 ease-out",
                    "hover:bg-secondary",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isActive && "bg-secondary",
                  )}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent-purple" />
                  )}
                  <span className={cn(
                    "flex-1 truncate text-sm transition-colors duration-200",
                    isActive ? "text-foreground font-medium" : "text-muted-foreground",
                  )}>
                    {task.title}
                  </span>
                  {onDeleteTask && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("sidebar.deleteTaskLabel", { title: task.title })}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTaskToDelete(task);
                      }}
                      className={cn(
                        "shrink-0 opacity-0 transition-opacity duration-150",
                        "text-muted-foreground-dim hover:text-destructive hover:bg-destructive/10",
                        "group-hover:opacity-100 group-focus-within:opacity-100",
                        "focus-visible:opacity-100",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
      </div>


      {/* Footer: language + theme toggle */}
      <div className={cn(
        "shrink-0 border-t border-border",
        collapsed ? "flex flex-col items-center gap-1 px-2 py-2" : "space-y-1 px-4 py-3",
      )}>
        <LanguageSwitcher collapsed={collapsed} />
        <ThemeToggle collapsed={collapsed} />
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={taskToDelete !== null} onOpenChange={handleDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sidebar.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.deleteConfirmDesc", { title: taskToDelete?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-primary-foreground hover:bg-destructive/90">
              {t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Drag handle for resizing (hidden on mobile) */}
      {!collapsed && !isMobile && (
        <div
          onMouseDown={handleDragStart}
          className={cn(
            "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30",
            isDragging && "bg-primary/30",
          )}
        />
      )}
    </aside>
  );
}
