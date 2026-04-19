import type { AgentEvent, ToolCallInfo } from "@/shared/types";

export type ThreadTaskStatus =
  | "scheduled"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface ThreadTask {
  readonly taskId: string;
  readonly title: string;
  readonly message: string;
  readonly status: ThreadTaskStatus;
  readonly delaySeconds: number | null;
  readonly createdAt: number | null;
  readonly scheduledFor: number | null;
  readonly completedAt: number | null;
  readonly updatedAt: number;
}

interface TaskSnapshot {
  readonly task_id?: unknown;
  readonly title?: unknown;
  readonly message?: unknown;
  readonly delay_seconds?: unknown;
  readonly created_at?: unknown;
  readonly scheduled_for?: unknown;
  readonly status?: unknown;
  readonly completed_at?: unknown;
}

function parseSnapshot(output: string | undefined): TaskSnapshot | null {
  if (!output) return null;
  try {
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TaskSnapshot;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function normalizeStatus(value: unknown): ThreadTaskStatus | null {
  switch (value) {
    case "scheduled":
    case "running":
    case "completed":
    case "cancelled":
    case "failed":
      return value;
    default:
      return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveThreadTasks(
  toolCalls: readonly ToolCallInfo[],
  events: readonly AgentEvent[],
): ThreadTask[] {
  const tasks = new Map<string, ThreadTask>();

  for (const toolCall of toolCalls) {
    if (
      toolCall.name !== "task_schedule"
      && toolCall.name !== "task_watch"
      && toolCall.name !== "task_resume"
      && toolCall.name !== "task_cancel"
    ) {
      continue;
    }

    const snapshot = parseSnapshot(toolCall.output);
    if (!snapshot) continue;

    const taskId = readString(snapshot.task_id);
    if (!taskId) continue;

    const existing = tasks.get(taskId);
    const input = toolCall.input ?? {};
    const fallbackTitle = readString(input.title) ?? "Scheduled task";
    const fallbackMessage = readString(input.message) ?? "";
    const snapshotDelay = toFiniteNumber(snapshot.delay_seconds);
    const inputDelay = toFiniteNumber(input.delay_seconds);
    const delaySeconds = snapshotDelay ?? inputDelay;
    const snapshotCreatedAt = toFiniteNumber(snapshot.created_at);
    const createdAt = snapshotCreatedAt !== null
      ? snapshotCreatedAt * 1000
      : existing?.createdAt ?? toolCall.timestamp;
    const snapshotScheduledFor = toFiniteNumber(snapshot.scheduled_for);
    const scheduledFor = snapshotScheduledFor !== null
      ? snapshotScheduledFor * 1000
      : delaySeconds !== null && createdAt !== null
        ? createdAt + (delaySeconds * 1000)
        : existing?.scheduledFor ?? null;
    const snapshotCompletedAt = toFiniteNumber(snapshot.completed_at);
    const completedAt = snapshotCompletedAt !== null
      ? snapshotCompletedAt * 1000
      : existing?.completedAt ?? null;

    tasks.set(taskId, {
      taskId,
      title: readString(snapshot.title) ?? existing?.title ?? fallbackTitle,
      message: readString(snapshot.message) ?? existing?.message ?? fallbackMessage,
      status: normalizeStatus(snapshot.status) ?? existing?.status ?? "scheduled",
      delaySeconds: delaySeconds ?? existing?.delaySeconds ?? null,
      createdAt,
      scheduledFor,
      completedAt,
      updatedAt: toolCall.timestamp,
    });
  }

  for (const event of events) {
    if (event.type !== "message_user") continue;

    const taskId = readString(event.data.background_task_id);
    if (!taskId) continue;

    const existing = tasks.get(taskId);
    tasks.set(taskId, {
      taskId,
      title: readString(event.data.title) ?? existing?.title ?? "Scheduled task",
      message: readString(event.data.message) ?? existing?.message ?? "",
      status: "completed",
      delaySeconds: existing?.delaySeconds ?? null,
      createdAt: existing?.createdAt ?? null,
      scheduledFor: existing?.scheduledFor ?? null,
      completedAt: event.timestamp,
      updatedAt: event.timestamp,
    });
  }

  return [...tasks.values()]
    .filter((task) => task.status === "scheduled" || task.status === "running")
    .sort((left, right) => {
      const leftSort = left.scheduledFor ?? left.updatedAt;
      const rightSort = right.scheduledFor ?? right.updatedAt;
      return leftSort - rightSort;
    });
}
