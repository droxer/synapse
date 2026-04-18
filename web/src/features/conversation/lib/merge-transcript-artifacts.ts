import type { ArtifactInfo } from "@/shared/types";

/**
 * Persisted artifacts are authoritative after turn finalization, but live SSE
 * events may surface newer artifacts before the database refresh completes.
 */
export function mergeHistoryWithEventDerivedArtifacts(
  historyArtifacts: readonly ArtifactInfo[],
  eventDerivedArtifacts: readonly ArtifactInfo[],
): ArtifactInfo[] {
  if (historyArtifacts.length === 0) {
    return [...eventDerivedArtifacts];
  }
  if (eventDerivedArtifacts.length === 0) {
    return [...historyArtifacts];
  }

  const byId = new Map<string, ArtifactInfo>();

  for (const artifact of eventDerivedArtifacts) {
    byId.set(artifact.id, artifact);
  }
  for (const artifact of historyArtifacts) {
    const existing = byId.get(artifact.id);
    byId.set(artifact.id, existing ? { ...existing, ...artifact } : artifact);
  }

  return [...byId.values()].sort((a, b) => {
    const left = a.createdAt ? Date.parse(a.createdAt) : 0;
    const right = b.createdAt ? Date.parse(b.createdAt) : 0;
    return right - left;
  });
}
