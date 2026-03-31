"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/shared/components/Logo";
import { Plus, PanelLeftClose, PanelLeftOpen, Trash2, Blocks, FolderOpen, Lightbulb, Radio } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
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
  activePath?: string;
  userMenu?: React.ReactNode;
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
  onClose: _onClose,
  isMobile = false,
  activePath,
  userMenu,
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
      <div className={cn("relative flex items-center py-3", collapsed ? "flex-col gap-2 px-2" : "justify-between px-4")}>
        <div className="flex items-center gap-2">
          <Logo size={28} className="rounded-md" />
          {!collapsed && (
            <span className="text-sm font-medium text-foreground whitespace-nowrap">
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
                <button
                  type="button"
                  onClick={onNewTask}
                  aria-label={t("sidebar.newTask")}
                  className={cn(
                    "group/new flex w-full items-center justify-center rounded-md p-2",
                    "border border-transparent",
                    "transition-all duration-200",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    activePath === "/" && !activeTaskId
                      ? "bg-sidebar-active text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-hover hover:border-border",
                  )}
                >
                  <Plus className="h-4 w-4 transition-transform duration-200 group-hover/new:rotate-90" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.newTask")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/channels">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "w-full",
                      activePath === "/channels"
                        ? "bg-sidebar-active text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-hover",
                    )}
                    asChild
                  >
                    <span>
                      <Radio className="h-4 w-4" />
                    </span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.channels")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/library">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "w-full",
                      activePath === "/library"
                        ? "bg-sidebar-active text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-hover",
                    )}
                    asChild
                  >
                    <span>
                      <FolderOpen className="h-4 w-4" />
                    </span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.library")}</TooltipContent>
            </Tooltip>
            <div className="border-t border-border mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/skills">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "w-full",
                      activePath === "/skills"
                        ? "bg-sidebar-active text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-hover",
                    )}
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
                    className={cn(
                      "w-full",
                      activePath === "/mcp"
                        ? "bg-sidebar-active text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-hover",
                    )}
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
            <button
              type="button"
              onClick={onNewTask}
              className={cn(
                "group/new flex w-full items-center gap-2 rounded-md px-3 py-2.5",
                "border border-transparent",
                "transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                activePath === "/" && !activeTaskId
                  ? "bg-sidebar-active"
                  : "hover:bg-sidebar-hover hover:border-border",
              )}
            >
              <Plus className="h-4 w-4 shrink-0 text-muted-foreground transition-all duration-200 group-hover/new:rotate-90 group-hover/new:text-foreground" />
              <span className="text-sm font-medium text-foreground">
                {t("sidebar.newTask")}
              </span>
            </button>
            <Link
              href="/channels"
              aria-label={t("sidebar.channels")}
              className={cn(
                "group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                activePath === "/channels"
                  ? "bg-sidebar-active text-foreground"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              {activePath === "/channels" && (
                <div className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-md bg-[#2AABEE]" aria-hidden="true" />
              )}
              <Radio className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/channels" ? "text-[#2AABEE]" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.channels")}
            </Link>
            <Link
              href="/library"
              aria-label={t("sidebar.library")}
              className={cn(
                "group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                activePath === "/library"
                  ? "bg-sidebar-active text-foreground"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              {activePath === "/library" && (
                <div className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-md bg-accent-amber" aria-hidden="true" />
              )}
              <FolderOpen className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/library" ? "text-accent-amber" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.library")}
            </Link>
            <div className="border-t border-border" />
            <Link
              href="/skills"
              aria-label={t("sidebar.skills")}
              className={cn(
                "group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                activePath === "/skills"
                  ? "bg-sidebar-active text-foreground"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              {activePath === "/skills" && (
                <div className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-md bg-accent-emerald" aria-hidden="true" />
              )}
              <Lightbulb className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/skills" ? "text-accent-emerald" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.skills")}
            </Link>
            <Link
              href="/mcp"
              aria-label={t("sidebar.mcp")}
              className={cn(
                "group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                activePath === "/mcp"
                  ? "bg-sidebar-active text-foreground"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              {activePath === "/mcp" && (
                <div className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-md bg-accent-purple" aria-hidden="true" />
              )}
              <Blocks className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/mcp" ? "text-accent-purple" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.mcp")}
            </Link>
          </div>
        )}
      </div>

      {/* Separator between nav actions and task list */}
      <div className={cn("border-t border-border", collapsed ? "mx-2" : "mx-4")} />

      {/* Task list */}
      {!collapsed && (
        <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
          <span className="h-px w-3 shrink-0 bg-border-strong" aria-hidden="true" />
          <span className="text-micro font-semibold uppercase tracking-widest text-muted-foreground-dim whitespace-nowrap">
            {t("sidebar.recentTasks")}
          </span>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
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
                        "hover:bg-sidebar-hover",
                        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        isActive && "bg-sidebar-active",
                      )}
                    >
                      <div className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-md transition-colors duration-200",
                        isActive ? "bg-accent-purple" : "bg-border-strong",
                      )} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{task.title}</TooltipContent>
                </Tooltip>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  key={task.id}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelectTask?.(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectTask?.(task.id);
                    }
                  }}
                  className={cn(
                    "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 text-left",
                    "transition-colors duration-200 ease-out",
                    "hover:bg-sidebar-hover",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isActive && "bg-sidebar-active",
                  )}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-md bg-accent-purple" />
                  )}
                  <span
                    title={task.title}
                    className={cn(
                      "flex-1 truncate text-sm transition-colors duration-200",
                      isActive ? "text-foreground font-medium" : "text-sidebar-foreground-muted",
                    )}
                  >
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


      {/* Footer: user profile card (includes theme/language controls) */}
      <div
        className={cn(
          "shrink-0 border-t border-border",
          collapsed
            ? "flex flex-col items-center gap-1 px-2 py-2"
            : "px-4 py-2.5",
        )}
      >
        {userMenu}
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
          aria-hidden="true"
          className={cn(
            "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30",
            isDragging && "bg-primary/30",
          )}
        />
      )}
    </aside>
  );
}
