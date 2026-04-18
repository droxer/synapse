import { describe, expect, it } from "@jest/globals";
import {
  isConversationHistoryLoading,
  normalizeHistoryArtifact,
} from "./use-conversation-history";

describe("isConversationHistoryLoading", () => {
  it("treats a newly selected conversation as loading before the fetch effect settles", () => {
    expect(
      isConversationHistoryLoading("conversation-1", null, false),
    ).toBe(true);
  });

  it("stays loading while an in-flight history request is running", () => {
    expect(
      isConversationHistoryLoading("conversation-1", "conversation-1", true),
    ).toBe(true);
  });

  it("stops loading once the selected conversation has finished loading", () => {
    expect(
      isConversationHistoryLoading("conversation-1", "conversation-1", false),
    ).toBe(false);
  });

  it("does not report loading when no conversation is selected", () => {
    expect(isConversationHistoryLoading(null, null, false)).toBe(false);
  });

  it("normalizes persisted artifacts for the conversation artifact panel", () => {
    expect(normalizeHistoryArtifact({
      id: "artifact-1",
      name: "report.docx",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 15991,
      created_at: "2026-04-18T07:14:52.297999Z",
      file_path: "/workspace/report.docx",
    })).toEqual({
      id: "artifact-1",
      name: "report.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 15991,
      createdAt: "2026-04-18T07:14:52.297999Z",
      filePath: "/workspace/report.docx",
    });
  });
});
