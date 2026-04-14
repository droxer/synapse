"use client";

import { ArtifactExplorer } from "@/shared/components/ArtifactExplorer";
import type { ArtifactInfo } from "@/shared/types";

interface ArtifactFilesPanelProps {
  readonly artifacts: readonly ArtifactInfo[];
  readonly conversationId: string | null;
}

export function ArtifactFilesPanel({ artifacts, conversationId }: ArtifactFilesPanelProps) {
  return (
    <ArtifactExplorer
      mode="panel"
      artifacts={artifacts}
      conversationId={conversationId}
    />
  );
}
