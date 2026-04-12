import type { TaskState } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

export function isTaskStateLive(taskState: TaskState): boolean {
  return taskState === "executing" || taskState === "planning";
}

export function getTaskStateProgressIndicatorClass(taskState: TaskState): string {
  if (taskState === "complete") return "bg-accent-emerald";
  if (taskState === "error") return "bg-destructive";
  if (taskState === "executing") return "bg-focus";
  if (taskState === "planning") return "bg-muted-foreground";
  return "bg-muted-foreground";
}

export function getTaskStateAnnouncement(taskState: TaskState, t: TFn): string {
  if (taskState === "planning") return t("progress.statePlanning");
  if (taskState === "executing") return t("progress.stateExecuting");
  if (taskState === "complete") return t("progress.stateComplete");
  if (taskState === "error") return t("progress.stateError");
  return t("computer.statusIdle");
}
