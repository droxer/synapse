import { buildFileTree, type FolderNode } from "@/shared/components/ArtifactExplorer/artifactExplorerUtils";
import type { ArtifactInfo } from "@/shared/types";

export interface TaskArtifactItem extends ArtifactInfo {
  readonly createdAtMs: number;
  readonly directory: string | null;
  readonly displayPath: string;
  readonly isPreviewable: boolean;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function isPreviewableArtifact(artifact: Pick<ArtifactInfo, "contentType" | "name">): boolean {
  const ext = fileExtension(artifact.name);
  if (artifact.contentType.startsWith("image/")) return true;
  if (artifact.contentType === "application/pdf") return true;
  if (artifact.contentType === "text/html") return true;
  if (artifact.contentType.includes("wordprocessingml")) return true;
  if (artifact.contentType === "application/msword") return true;
  if (artifact.contentType.includes("spreadsheetml")) return true;
  if (artifact.contentType === "application/vnd.ms-excel") return true;
  if (artifact.contentType.includes("presentationml")) return true;
  if (artifact.contentType === "application/vnd.ms-powerpoint") return true;
  if (artifact.contentType.startsWith("text/")) return true;
  if (
    artifact.contentType.startsWith("text/x-")
    || artifact.contentType === "text/javascript"
    || artifact.contentType === "application/json"
  ) {
    return true;
  }
  return [
    "md",
    "txt",
    "json",
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "html",
    "css",
    "csv",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
  ].includes(ext);
}

export function normalizeTaskArtifacts(
  artifacts: readonly ArtifactInfo[],
): readonly TaskArtifactItem[] {
  return [...artifacts]
    .map((artifact): TaskArtifactItem => {
      const rawPath = artifact.filePath?.trim() || artifact.name;
      const slash = rawPath.lastIndexOf("/");
      const directory = slash > 0 ? rawPath.slice(0, slash) : null;
      const createdAtMs = artifact.createdAt ? new Date(artifact.createdAt).getTime() : 0;

      return {
        ...artifact,
        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
        directory,
        displayPath: rawPath,
        isPreviewable: isPreviewableArtifact(artifact),
      };
    })
    .sort((a, b) => {
      if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs;
      return a.name.localeCompare(b.name);
    });
}

export function hasNestedArtifactPaths(artifacts: readonly Pick<ArtifactInfo, "filePath" | "name">[]): boolean {
  return artifacts.some((artifact) => {
    const rawPath = artifact.filePath?.trim() || artifact.name;
    return rawPath.includes("/");
  });
}

export function splitRecentArtifacts(artifacts: readonly TaskArtifactItem[]): {
  readonly previewable: readonly TaskArtifactItem[];
  readonly compact: readonly TaskArtifactItem[];
} {
  const previewable: TaskArtifactItem[] = [];
  const compact: TaskArtifactItem[] = [];

  for (const artifact of artifacts) {
    if (artifact.isPreviewable) previewable.push(artifact);
    else compact.push(artifact);
  }

  return { previewable, compact };
}

export function buildTaskArtifactTree(artifacts: readonly TaskArtifactItem[]): FolderNode {
  return buildFileTree(
    artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      contentType: artifact.contentType,
      size: artifact.size,
      createdAt: artifact.createdAt,
      filePath: artifact.displayPath,
    })),
    "task-artifacts",
  );
}

export function findFolderNode(root: FolderNode, path: string): FolderNode | null {
  if (path === "/" || path === "") return root;
  for (const child of root.subFolders) {
    if (child.path === path) return child;
    const found = findFolderNode(child, path);
    if (found) return found;
  }
  return null;
}
