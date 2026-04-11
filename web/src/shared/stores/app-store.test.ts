import { describe, expect, it } from "@jest/globals";
import { toHistoryItem } from "./app-store";

describe("toHistoryItem", () => {
  it("maps running state from API payload", () => {
    const item = toHistoryItem({
      id: "conversation-1",
      title: "Test task",
      created_at: "2026-04-12T10:00:00Z",
      updated_at: "2026-04-12T10:00:01Z",
      is_running: true,
    });

    expect(item.isRunning).toBe(true);
  });

  it("defaults running state to false when omitted", () => {
    const item = toHistoryItem({
      id: "conversation-2",
      title: null,
      created_at: "2026-04-12T10:00:00Z",
      updated_at: "2026-04-12T10:00:01Z",
    });

    expect(item.title).toBe("Untitled");
    expect(item.isRunning).toBe(false);
  });
});
