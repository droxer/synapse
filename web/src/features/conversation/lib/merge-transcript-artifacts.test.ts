import { describe, expect, it } from "@jest/globals";
import { mergeHistoryWithEventDerivedArtifacts } from "./merge-transcript-artifacts";

describe("mergeHistoryWithEventDerivedArtifacts", () => {
  it("prefers persisted artifact fields while keeping the same artifact only once", () => {
    const merged = mergeHistoryWithEventDerivedArtifacts(
      [{
        id: "artifact-1",
        name: "report.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 16000,
        createdAt: "2026-04-18T07:14:52.297999Z",
        filePath: "/workspace/report.docx",
      }],
      [{
        id: "artifact-1",
        name: "report.docx",
        contentType: "application/octet-stream",
        size: 0,
      }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      id: "artifact-1",
      name: "report.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 16000,
      createdAt: "2026-04-18T07:14:52.297999Z",
      filePath: "/workspace/report.docx",
    });
  });

  it("keeps live-only artifacts before the persisted refresh lands", () => {
    const merged = mergeHistoryWithEventDerivedArtifacts(
      [],
      [{
        id: "artifact-2",
        name: "draft.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 12000,
        createdAt: "2026-04-18T07:14:53.000000Z",
      }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("artifact-2");
  });
});
