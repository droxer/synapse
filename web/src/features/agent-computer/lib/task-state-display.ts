import type { TaskState } from "@/shared/types";
import type { TFn } from "@/shared/types/i18n";

export function isTaskStateLive(taskState: TaskState): boolean {
  return taskState === "executing" || taskState === "planning";
}

export function getTaskStateProgressIndicatorClass(taskState: TaskState): string {
  if (taskState === "complete") return "bg-cobalt";
  if (taskState === "error") return "bg-critical-strong";
  if (taskState === "executing") return "bg-cobalt";
  if (taskState === "planning") return "bg-cobalt";
  return "bg-surface-soft-foreground";
}

export function getTaskStateAnnouncement(taskState: TaskState, t: TFn): string {
  if (taskState === "planning") return t("progress.statePlanning");
  if (taskState === "executing") return t("progress.stateExecuting");
  if (taskState === "complete") return t("progress.stateComplete");
  if (taskState === "error") return t("progress.stateError");
  return t("computer.statusIdle");
}
