import { describe, expect, it } from "@jest/globals";
import { resolveThreadTasks } from "./background-tasks";
import type { AgentEvent, ToolCallInfo } from "@/shared/types";

describe("resolveThreadTasks", () => {
  it("builds active thread tasks from task_schedule tool results", () => {
    const tasks = resolveThreadTasks(
      [
        {
          id: "tc-1",
          toolUseId: "tool-1",
          name: "task_schedule",
          input: {
            title: "Follow-up",
            message: "Check the uploaded report.",
            delay_seconds: 600,
          },
          output: JSON.stringify({ task_id: "bg_123", status: "scheduled" }),
          timestamp: 1_000,
        },
      ],
      [],
    );

    expect(tasks).toEqual([
      {
        taskId: "bg_123",
        title: "Follow-up",
        message: "Check the uploaded report.",
        status: "scheduled",
        delaySeconds: 600,
        createdAt: 1_000,
        scheduledFor: 601_000,
        completedAt: null,
        updatedAt: 1_000,
      },
    ]);
  });

  it("applies later task snapshots from task_watch", () => {
    const tasks = resolveThreadTasks(
      [
        {
          id: "tc-1",
          toolUseId: "tool-1",
          name: "task_schedule",
          input: { title: "Reminder", message: "Ping me later.", delay_seconds: 60 },
          output: JSON.stringify({ task_id: "bg_1", status: "scheduled" }),
          timestamp: 2_000,
        },
        {
          id: "tc-2",
          toolUseId: "tool-2",
          name: "task_watch",
          input: { task_id: "bg_1" },
          output: JSON.stringify({
            task_id: "bg_1",
            title: "Reminder",
            message: "Ping me later.",
            delay_seconds: 60,
            status: "running",
          }),
          timestamp: 3_000,
        },
      ],
      [],
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("running");
    expect(tasks[0]?.updatedAt).toBe(3_000);
  });

  it("drops tasks once a background completion message is emitted", () => {
    const toolCalls: ToolCallInfo[] = [
      {
        id: "tc-1",
        toolUseId: "tool-1",
        name: "task_schedule",
        input: { title: "Follow-up", message: "Check in later.", delay_seconds: 60 },
        output: JSON.stringify({ task_id: "bg_done", status: "scheduled" }),
        timestamp: 5_000,
      },
    ];
    const events: AgentEvent[] = [
      {
        type: "message_user",
        data: {
          background_task_id: "bg_done",
          title: "Follow-up",
          message: "Check in later.",
        },
        timestamp: 70_000,
        iteration: null,
      },
    ];

    expect(resolveThreadTasks(toolCalls, events)).toEqual([]);
  });
});
