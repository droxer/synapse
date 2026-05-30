"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/shared/components/Logo";
import { PulsingDot } from "@/shared/components/PulsingDot";
import { Plus, PanelLeftClose, PanelLeftOpen, Trash2, Blocks, FolderOpen, Lightbulb, Radio, GitFork } from "lucide-react";
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
        "relative flex h-screen shrink-0 flex-col overflow-hidden bg-sidebar-bg",
        collapsed ? "w-12" : "",
        !collapsed && !isDragging && "transition-[width] duration-200 ease-in-out",
      )}
      style={collapsed ? undefined : { width }}
    >
      {/* Header: logo + collapse/expand toggle */}
      <div className={cn("relative flex items-center py-3.5", collapsed ? "flex-col gap-2 px-2" : "justify-between px-4")}>
        <div className="flex items-center gap-2">
          <Logo size={28} tone="auto" className="rounded-full" />
          {!collapsed && (
            <span className="brand-wordmark whitespace-nowrap">
              {t("sidebar.brand")}
            </span>
          )}
        </div>
        {onToggle && (
          collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={!collapsed} aria-label={t("sidebar.expand")} className="text-steel hover:bg-sidebar-hover hover:text-ink-deep">
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.expand")}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={!collapsed} aria-label={t("sidebar.collapse")} className="text-steel hover:bg-sidebar-hover hover:text-ink-deep">
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.collapse")}</TooltipContent>
            </Tooltip>
          )
        )}
      </div>

      {/* New task + grouped navigation */}
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
                    "group/new flex w-full items-center justify-center rounded-full p-2",
                    "border border-transparent",
                    "transition-[color,background-color,border-color] duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                    activePath === "/" && !activeTaskId
                      ? "bg-sidebar-active text-ink-deep"
                      : "bg-sidebar-bg text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
                  )}
                >
                  <Plus className="h-4 w-4 transition-transform duration-200 group-hover/new:rotate-90" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.newTask")}</TooltipContent>
            </Tooltip>
            <div role="separator" aria-hidden="true" className="my-1 h-px bg-border/60" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/library"
                      ? "bg-sidebar-active text-ink-deep"
                      : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
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
            <div role="separator" aria-hidden="true" className="my-1 h-px bg-border/60" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/channels"
                      ? "bg-sidebar-active text-ink-deep"
                      : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
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
            <div role="separator" aria-hidden="true" className="my-1 h-px bg-border/60" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "w-full",
                    activePath === "/skills"
                      ? "bg-sidebar-active text-ink-deep"
                      : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
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
                      ? "bg-sidebar-active text-ink-deep"
                      : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
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
                "group/new flex w-full items-center gap-2.5 rounded-full px-3 py-2",
                "transition-colors duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                isMobile && "min-h-11",
                activePath === "/" && !activeTaskId
                  ? "bg-sidebar-active text-ink-deep"
                  : "text-ink-deep hover:bg-sidebar-hover",
              )}
            >
              <Plus className="h-4 w-4 shrink-0 text-ink transition-transform duration-200 group-hover/new:rotate-90" />
              <span className="text-body-sm-bold">
                {t("sidebar.newTask")}
              </span>
            </button>

            <div role="separator" aria-hidden="true" className="my-2 h-px bg-hairline-soft/60" />
            <Link
              href="/library"
              onClick={createNavClickHandler("/library")}
              aria-label={t("sidebar.library")}
              className={cn(
                "group flex items-center gap-2.5 rounded-full px-3 py-2 text-body-sm-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                isMobile && "min-h-11",
                activePath === "/library"
                  ? "bg-sidebar-active text-ink-deep"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
              )}
            >
              <FolderOpen className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/library" ? "text-ink-deep" : "text-steel group-hover:text-ink-deep",
              )} />
              {t("sidebar.library")}
            </Link>

            <div role="separator" aria-hidden="true" className="my-2 h-px bg-hairline-soft/60" />
            <Link
              href="/channels"
              onClick={createNavClickHandler("/channels")}
              aria-label={t("sidebar.channels")}
              className={cn(
                "group flex items-center gap-2.5 rounded-full px-3 py-2 text-body-sm-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                isMobile && "min-h-11",
                activePath === "/channels"
                  ? "bg-sidebar-active text-ink-deep"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
              )}
            >
              <Radio className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/channels" ? "text-ink-deep" : "text-steel group-hover:text-ink-deep",
              )} />
              {t("sidebar.channels")}
            </Link>

            <div role="separator" aria-hidden="true" className="my-2 h-px bg-hairline-soft/60" />
            <Link
              href="/skills"
              onClick={createNavClickHandler("/skills")}
              aria-label={t("sidebar.skills")}
              className={cn(
                "group flex items-center gap-2.5 rounded-full px-3 py-2 text-body-sm-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                isMobile && "min-h-11",
                activePath === "/skills"
                  ? "bg-sidebar-active text-ink-deep"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
              )}
            >
              <Lightbulb className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/skills" ? "text-ink-deep" : "text-steel group-hover:text-ink-deep",
              )} />
              {t("sidebar.skills")}
            </Link>
            <Link
              href="/mcp"
              onClick={createNavClickHandler("/mcp")}
              aria-label={t("sidebar.mcp")}
              className={cn(
                "group flex items-center gap-2.5 rounded-full px-3 py-2 text-body-sm-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                isMobile && "min-h-11",
                activePath === "/mcp"
                  ? "bg-sidebar-active text-ink-deep"
                  : "text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-ink-deep",
              )}
            >
              <Blocks className={cn(
                "h-4 w-4 shrink-0 transition-colors duration-200",
                activePath === "/mcp" ? "text-ink-deep" : "text-steel group-hover:text-ink-deep",
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
        <div className="px-4 pb-1 pt-4">
          <span className="label-mono whitespace-nowrap text-steel">
            {t("sidebar.recentTasks")}
          </span>
        </div>
      )}
      <div ref={scrollRef} className={cn("relative min-h-0 flex-1 overflow-y-auto", collapsed ? "px-2" : "px-4 pt-0.5")}>
          <div className="space-y-1 pb-2">
            {!collapsed && taskHistory.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-steel-dim">
                {t("sidebar.noTasks")}
              </p>
            )}
            {taskHistory.map((task) => {
              const isActive = task.id === activeTaskId;
              const isPlanner = task.orchestratorMode === "planner";
              const taskTooltip = isPlanner
                ? `${t("sidebar.planTask")} · ${task.title}`
                : task.title;
              return collapsed ? (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSelectTask?.(task.id)}
                      aria-label={task.title}
                      className={cn(
                        "relative flex w-full cursor-pointer items-center justify-center rounded-full p-2 transition-colors duration-200",
                        "hover:bg-sidebar-hover",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                        isActive && "bg-sidebar-active",
                      )}
                    >
                      {isPlanner ? (
                        <GitFork
                          className={cn(
                            "h-3.5 w-3.5 transition-colors duration-200",
                            isActive ? "text-focus" : "text-ink",
                          )}
                        />
                      ) : (
                        <div className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                          isActive ? "bg-focus" : "bg-border-strong",
                        )} />
                      )}
                      {task.isRunning && (
                        <span className="absolute right-1.5 top-1.5">
                          <PulsingDot size="sm" />
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{taskTooltip}</TooltipContent>
                </Tooltip>
              ) : (
                <div key={task.id} className="group relative">
                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelectTask?.(task.id)}
                    className={cn(
                      "relative flex w-full cursor-pointer items-center gap-2.5 rounded-full px-3 py-2 pr-9 text-left",
                      "transition-colors duration-200 ease-out",
                      "hover:bg-sidebar-hover",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                      isMobile && "min-h-11",
                      isActive && "bg-sidebar-active",
                    )}
                  >
                    {task.isRunning && <PulsingDot size="sm" className="shrink-0" />}
                    <span
                      title={task.title}
                      className={cn(
                        "min-w-0 flex-1 truncate text-body-sm transition-colors duration-200",
                        isActive ? "font-bold text-ink-deep" : "text-sidebar-foreground-muted",
                        task.isRunning && !isActive && "text-ink-deep",
                      )}
                    >
                      {task.title}
                    </span>
                    {isPlanner && (
                      <span
                        title={t("sidebar.planTask")}
                        className={cn(
                          "status-pill shrink-0",
                          isActive
                            ? "status-primary"
                            : "status-ai",
                        )}
                      >
                        <GitFork className="h-3 w-3" />
                        <span>{t("topbar.plan")}</span>
                      </span>
                    )}
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
                        "text-stone hover:text-critical hover:bg-critical/10",
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
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-critical-strong text-canvas hover:bg-critical">
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
            "absolute right-0 top-0 h-full w-px cursor-col-resize bg-transparent transition-colors hover:bg-border-strong/60 active:bg-border-strong",
            isDragging && "bg-border-strong",
          )}
        />
      )}
    </aside>
  );
}
