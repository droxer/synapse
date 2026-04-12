import type { PendingNewTask } from "@/shared/stores/app-store";

interface PendingTaskAutostartParams {
  readonly pathname: string;
  readonly pendingNewTask: PendingNewTask | null;
  readonly isActive: boolean;
}

export function shouldShowConversationWorkspace(
  conversationId: string | null,
  isWaitingForAgent: boolean,
): boolean {
  return conversationId !== null || isWaitingForAgent;
}

export function shouldAutoStartPendingTask({
  pathname,
  pendingNewTask,
  isActive,
}: PendingTaskAutostartParams): boolean {
  return pathname === "/" && pendingNewTask !== null && !isActive;
}
