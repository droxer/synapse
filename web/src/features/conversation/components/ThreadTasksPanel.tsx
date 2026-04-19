"use client";

import { BellRing, Clock3, Radar } from "lucide-react";
import { formatClockTime } from "@/shared/lib/date-time";
import { cn } from "@/shared/lib/utils";
import type { Locale } from "@/i18n/types";
import type { ThreadTask } from "../lib/background-tasks";

interface ThreadTasksPanelProps {
  readonly tasks: readonly ThreadTask[];
  readonly locale: Locale;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

function getStatusBadgeClass(status: ThreadTask["status"]): string {
  switch (status) {
    case "running":
      return "status-pill status-info";
    case "scheduled":
    default:
      return "status-pill status-neutral";
  }
}

function getStatusLabel(
  status: ThreadTask["status"],
  t: ThreadTasksPanelProps["t"],
): string {
  switch (status) {
    case "running":
      return t("threadTasks.statusRunning");
    case "scheduled":
    default:
      return t("threadTasks.statusScheduled");
  }
}

export function ThreadTasksPanel({
  tasks,
  locale,
  t,
}: ThreadTasksPanelProps) {
  if (tasks.length === 0) return null;

  return (
    <section
      aria-label={t("threadTasks.title")}
      className="shrink-0 border-b border-border bg-[linear-gradient(180deg,rgba(148,163,184,0.05),rgba(148,163,184,0.015)_100%)]"
    >
      <div className="px-3 py-3">
        <div className="rounded-xl border border-border bg-card/95 px-3 py-3 shadow-card">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
              <Radar className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-foreground">
                  {t("threadTasks.title")}
                </h2>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                  {tasks.length}
                </span>
              </div>
              <p className="mt-0.5 text-micro text-muted-foreground-dim">
                {t("threadTasks.subtitle")}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {tasks.map((task) => (
              <article
                key={task.taskId}
                className="rounded-xl border border-border bg-background/80 px-3 py-3"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("shrink-0", getStatusBadgeClass(task.status))}>
                        {getStatusLabel(task.status, t)}
                      </span>
                      <span className="text-micro uppercase tracking-[0.14em] text-muted-foreground-dim">
                        {t("threadTasks.scope")}
                      </span>
                    </div>
                    <h3 className="mt-2 truncate text-sm font-medium text-foreground">
                      {task.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {task.message || t("threadTasks.fallbackMessage")}
                    </p>
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
                    {task.status === "running" ? (
                      <BellRing className="h-4 w-4" />
                    ) : (
                      <Clock3 className="h-4 w-4" />
                    )}
                  </div>
                </div>

                {task.scheduledFor && (
                  <div className="mt-3 border-t border-border/70 pt-2 text-right">
                    <span className="font-mono text-micro text-muted-foreground">
                      {t("threadTasks.dueAt", {
                        time: formatClockTime(task.scheduledFor, locale),
                      })}
                    </span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
