import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadTasksPanel } from "./ThreadTasksPanel";

jest.mock("lucide-react", () => ({
  BellRing: () => React.createElement("span", null, "bell"),
  Clock3: () => React.createElement("span", null, "clock"),
  Radar: () => React.createElement("span", null, "radar"),
}));

describe("ThreadTasksPanel", () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    if (key === "threadTasks.dueAt") return `Due ${params?.time ?? ""}`;
    const translations: Record<string, string> = {
      "threadTasks.title": "Thread tasks",
      "threadTasks.subtitle": "Live thread-local follow-ups",
      "threadTasks.statusScheduled": "Scheduled",
      "threadTasks.statusRunning": "Running",
      "threadTasks.scope": "thread-local",
      "threadTasks.fallbackMessage": "Conversation-local reminder",
    };
    return translations[key] ?? key;
  };

  it("returns null when there are no tasks", () => {
    const html = renderToStaticMarkup(
      <ThreadTasksPanel tasks={[]} locale="en" t={t} />,
    );

    expect(html).toBe("");
  });

  it("renders scheduled and running task cards", () => {
    const html = renderToStaticMarkup(
      <ThreadTasksPanel
        locale="en"
        t={t}
        tasks={[
          {
            taskId: "task-1",
            title: "Follow up",
            message: "Check the report",
            status: "scheduled",
            delaySeconds: 60,
            createdAt: 0,
            scheduledFor: Date.UTC(2025, 0, 1, 8, 30),
            completedAt: null,
            updatedAt: 0,
          },
          {
            taskId: "task-2",
            title: "Ping user",
            message: "",
            status: "running",
            delaySeconds: 0,
            createdAt: 0,
            scheduledFor: Date.UTC(2025, 0, 1, 8, 31),
            completedAt: null,
            updatedAt: 0,
          },
        ]}
      />,
    );

    expect(html).toContain("Thread tasks");
    expect(html).toContain("Live thread-local follow-ups");
    expect(html).toContain("Follow up");
    expect(html).toContain("Ping user");
    expect(html).toContain("Check the report");
    expect(html).toContain("Conversation-local reminder");
    expect(html).toContain("Scheduled");
    expect(html).toContain("Running");
    expect(html).toContain("thread-local");
    expect(html).toContain("Due");
  });
});
