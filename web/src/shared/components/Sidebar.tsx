"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/shared/components/Logo";
import { PulsingDot } from "@/shared/components/PulsingDot";
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
  onNavigate?: (href: string) => void;
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
  onNavigate,
  collapsed = false,
  width = 256,
  onToggle,
  onWidthChange,
  onLoadMore,
  onDeleteTask,
  onClose,
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
  const createNavClickHandler = useCallback(
    (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (onNavigate) {
        e.preventDefault();
        onNavigate(href);
        return;
      }
      onClose?.();
    },
    [onClose, onNavigate],
  );

  return (
    <aside
      className={cn(
        "relative flex h-screen shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar-bg",
        collapsed ? "w-12" : "",
        !collapsed && !isDragging && "transition-[width] duration-200 ease-in-out",
      )}
      style={collapsed ? undefined : { width }}
    >
      {/* Header: logo + collapse/expand toggle */}
      <div className={cn("relative flex items-center border-b border-border/50 py-3.5", collapsed ? "flex-col gap-2 px-2" : "justify-between px-4")}>
        <div className="flex items-center gap-2">
          <Logo size={28} tone="auto" className="rounded-md" />
          {!collapsed && (
            <span className="brand-wordmark whitespace-nowrap text-[0.78rem] tracking-[0.07em]">
              {t("sidebar.brand")}
            </span>
          )}
        </div>
        {onToggle && (
          collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={!collapsed} aria-label={t("sidebar.expand")} className="text-muted-foreground hover:bg-sidebar-hover hover:text-foreground">
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.expand")}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={!collapsed} aria-label={t("sidebar.collapse")} className="text-muted-foreground hover:bg-sidebar-hover hover:text-foreground">
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.collapse")}</TooltipContent>
            </Tooltip>
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
                    "transition-[color,background-color,border-color] duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    activePath === "/" && !activeTaskId
                      ? "border-border-strong bg-sidebar-active text-foreground"
                      : "text-muted-foreground bg-sidebar-hover/40 hover:text-foreground hover:bg-sidebar-hover hover:border-border",
                  )}
                >
                  <Plus className="h-4 w-4 transition-transform duration-200 group-hover/new:rotate-90" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.newTask")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/channels"
                      ? "bg-sidebar-active text-foreground"
                      : "text-muted-foreground bg-sidebar-hover/40 hover:text-foreground hover:bg-sidebar-hover",
                  )}
                  asChild
                >
                  <Link href="/channels" onClick={createNavClickHandler("/channels")}>
                    <Radio className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.channels")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/library"
                      ? "bg-sidebar-active text-foreground"
                      : "text-muted-foreground bg-sidebar-hover/40 hover:text-foreground hover:bg-sidebar-hover",
                  )}
                  asChild
                >
                  <Link href="/library" onClick={createNavClickHandler("/library")}>
                    <FolderOpen className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.library")}</TooltipContent>
            </Tooltip>
            <div role="separator" aria-hidden="true" className="my-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/skills"
                      ? "bg-sidebar-active text-foreground"
                      : "text-muted-foreground bg-sidebar-hover/40 hover:text-foreground hover:bg-sidebar-hover",
                  )}
                  asChild
                >
                  <Link href="/skills" onClick={createNavClickHandler("/skills")}>
                    <Lightbulb className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.skills")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/mcp"
                      ? "bg-sidebar-active text-foreground"
                      : "text-muted-foreground bg-sidebar-hover/40 hover:text-foreground hover:bg-sidebar-hover",
                  )}
                  asChild
                >
                  <Link href="/mcp" onClick={createNavClickHandler("/mcp")}>
                    <Blocks className="h-4 w-4" />
                  </Link>
                </Button>
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
                "group/new flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5",
                "border",
                "transition-all duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activePath === "/" && !activeTaskId
                  ? "border-primary/30 bg-primary/8 text-foreground shadow-sm"
                  : "border-border/60 hover:border-primary/25 hover:bg-primary/5 hover:shadow-sm",
              )}
            >
              <Plus className="h-4 w-4 shrink-0 text-primary/70 transition-[color,transform] duration-200 group-hover/new:rotate-90 group-hover/new:text-primary" />
              <span className="text-sm font-medium text-foreground">
                {t("sidebar.newTask")}
              </span>
            </button>
            <Link
              href="/channels"
              onClick={createNavClickHandler("/channels")}
              aria-label={t("sidebar.channels")}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activePath === "/channels"
                  ? "bg-sidebar-active text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary relative"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              <Radio className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/channels" ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.channels")}
            </Link>
            <Link
              href="/library"
              onClick={createNavClickHandler("/library")}
              aria-label={t("sidebar.library")}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activePath === "/library"
                  ? "bg-sidebar-active text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary relative"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              <FolderOpen className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/library" ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.library")}
            </Link>
            <div role="separator" aria-hidden="true" className="my-1.5 mx-2.5 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
            <Link
              href="/skills"
              onClick={createNavClickHandler("/skills")}
              aria-label={t("sidebar.skills")}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activePath === "/skills"
                  ? "bg-sidebar-active text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary relative"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              <Lightbulb className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/skills" ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.skills")}
            </Link>
            <Link
              href="/mcp"
              onClick={createNavClickHandler("/mcp")}
              aria-label={t("sidebar.mcp")}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                activePath === "/mcp"
                  ? "bg-sidebar-active text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary relative"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-foreground",
              )}
            >
              <Blocks className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/mcp" ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )} />
              {t("sidebar.mcp")}
            </Link>
          </div>
        )}
      </div>

      {/* Spacing between nav actions and task list */}
      <div className={cn("h-2", collapsed ? "mx-2" : "mx-4")} />

      {/* Task list */}
      {!collapsed && (
        <div className="flex items-center gap-2.5 px-4 pb-1 pt-2.5">
          <span className="label-mono text-muted-foreground-dim/70 whitespace-nowrap text-[0.6rem] tracking-[0.08em]">
            {t("sidebar.recentTasks")}
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-border/60 to-transparent" aria-hidden="true" />
        </div>
      )}
      <div ref={scrollRef} className={cn("relative min-h-0 flex-1 overflow-y-auto", collapsed ? "px-2" : "px-4 pt-0.5")}>
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
                      aria-label={task.title}
                      className={cn(
                        "relative flex w-full cursor-pointer items-center justify-center rounded-md p-2 transition-colors duration-200",
                        "hover:bg-sidebar-hover",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        isActive && "bg-sidebar-active ring-1 ring-border-strong",
                      )}
                    >
                      {task.isRunning ? (
                        <PulsingDot size="sm" />
                      ) : (
                        <div className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-md transition-colors duration-200",
                          isActive ? "bg-focus" : "bg-border-strong",
                        )} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{task.title}</TooltipContent>
                </Tooltip>
              ) : (
                <div key={task.id} className="group relative">
                  {/* Running task: animated left accent bar */}
                  {task.isRunning && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-focus animate-[pulsing-dot-fade_2s_ease-in-out_infinite]"
                    />
                  )}
                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelectTask?.(task.id)}
                    className={cn(
                      "relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 pr-9 text-left",
                      "transition-[color,background-color] duration-200 ease-out",
                      "hover:bg-sidebar-hover",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      isActive && "bg-sidebar-active before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-primary",
                    )}
                  >
                    {task.isRunning && <PulsingDot size="sm" className="shrink-0" />}
                    <span
                      title={task.title}
                      className={cn(
                        "flex-1 truncate text-sm transition-colors duration-200",
                        isActive ? "font-medium text-foreground" : "text-sidebar-foreground-muted",
                        task.isRunning && !isActive && "text-foreground",
                      )}
                    >
                      {task.title}
                    </span>
                  </button>
                  {onDeleteTask && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("sidebar.deleteTaskLabel", { title: task.title })}
                      onClick={() => setTaskToDelete(task)}
                      className={cn(
                        "absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 transition-opacity duration-150",
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
          "shrink-0",
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
