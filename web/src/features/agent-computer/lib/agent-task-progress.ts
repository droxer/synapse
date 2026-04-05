import type { TaskState } from "@/shared/types";

/**
 * Progress bar value aligned across AgentProgressCard and AgentComputerPanel:
 * - complete → 100%
 * - idle or no items → 0%
 * - error → actual completion ratio (uncapped), bar uses error color
 * - planning / executing → ratio capped at 95% until task completes
 */
export function computeAgentTaskProgressPercent(
  taskState: TaskState,
  completedCount: number,
  totalCount: number,
): number {
  if (totalCount === 0) return 0;
  if (taskState === "complete") return 100;
  if (taskState === "idle") return 0;

  const ratioPercent = (completedCount / totalCount) * 100;

  if (taskState === "error") {
    return Math.round(Math.min(100, ratioPercent));
  }

  return Math.round(Math.min(95, ratioPercent));
}
