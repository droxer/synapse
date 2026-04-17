import { describe, expect, it } from "@jest/globals";
import {
  buildTaskArtifactTree,
  findFolderNode,
  hasNestedArtifactPaths,
  normalizeTaskArtifacts,
  splitRecentArtifacts,
} from "./ArtifactFilesPanel.utils";

describe("ArtifactFilesPanel utils", () => {
  const artifacts = [
    {
      id: "a-1",
      name: "summary.md",
      contentType: "text/markdown",
      size: 10,
      createdAt: "2026-04-16T10:00:00.000Z",
      filePath: "reports/summary.md",
    },
    {
      id: "a-2",
      name: "archive.zip",
      contentType: "application/zip",
      size: 15,
      createdAt: "2026-04-16T09:00:00.000Z",
    },
    {
      id: "a-3",
      name: "preview.png",
      contentType: "image/png",
      size: 20,
      createdAt: "2026-04-16T11:00:00.000Z",
      filePath: "outputs/images/preview.png",
    },
  ] as const;

  it("normalizes artifacts into recent-first task items", () => {
    const normalized = normalizeTaskArtifacts(artifacts);

    expect(normalized.map((artifact) => artifact.id)).toEqual(["a-3", "a-1", "a-2"]);
    expect(normalized[0]?.directory).toBe("outputs/images");
    expect(normalized[0]?.displayPath).toBe("outputs/images/preview.png");
    expect(normalized[0]?.isPreviewable).toBe(true);
    expect(normalized[2]?.isPreviewable).toBe(false);
  });

  it("detects when path browsing should be available", () => {
    expect(hasNestedArtifactPaths(artifacts)).toBe(true);
    expect(hasNestedArtifactPaths([
      { name: "flat.txt" },
      { name: "another.csv", filePath: "another.csv" },
    ])).toBe(false);
  });

  it("splits previewable and compact artifacts", () => {
    const normalized = normalizeTaskArtifacts(artifacts);
    const split = splitRecentArtifacts(normalized);

    expect(split.previewable.map((artifact) => artifact.id)).toEqual(["a-3", "a-1"]);
    expect(split.compact.map((artifact) => artifact.id)).toEqual(["a-2"]);
  });

  it("treats docx artifacts as previewable", () => {
    const normalized = normalizeTaskArtifacts([
      {
        id: "docx-1",
        name: "palantir-ontology-report.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 30,
        createdAt: "2026-04-16T12:00:00.000Z",
        filePath: "outputs/palantir-ontology-report.docx",
      },
    ]);

    expect(normalized[0]?.isPreviewable).toBe(true);
  });

  it("builds a folder tree from file paths and finds folders by path", () => {
    const normalized = normalizeTaskArtifacts(artifacts);
    const tree = buildTaskArtifactTree(normalized);

    expect(tree.items.map((item) => item.id)).toEqual(["a-2"]);

    const outputsFolder = findFolderNode(tree, "outputs");
    const nestedFolder = findFolderNode(tree, "outputs/images");
    const reportsFolder = findFolderNode(tree, "reports");

    expect(outputsFolder?.name).toBe("outputs");
    expect(nestedFolder?.items.map((item) => item.id)).toEqual(["a-3"]);
    expect(reportsFolder?.items.map((item) => item.id)).toEqual(["a-1"]);
  });
});
