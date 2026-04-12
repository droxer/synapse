"use client";

import { useState, useCallback } from "react";

// Re-export types so existing importers of this module are unaffected
export type {
  ArtifactExplorerItem,
  FolderNode,
  ConversationNode,
} from "./artifactExplorerUtils";

// Re-export pure functions so existing importers of this module are unaffected
export {
  groupByConversation,
} from "./artifactExplorerUtils";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ArtifactExplorerState {
  readonly selectedFolderId: string | null;
  readonly selectedFileId: string | null;
  readonly expandedConversations: ReadonlySet<string>;
  readonly selectFolder: (id: string | null) => void;
  readonly selectFile: (id: string | null) => void;
  readonly toggleConversation: (id: string) => void;
}

export function useArtifactExplorer(): ArtifactExplorerState {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [expandedConversations, setExpandedConversations] = useState<ReadonlySet<string>>(new Set());

  const selectFolder = useCallback((id: string | null): void => {
    setSelectedFolderId(id);
    setSelectedFileId(null);
  }, []);

  const selectFile = useCallback((id: string | null): void => {
    setSelectedFileId(id);
  }, []);

  const toggleConversation = useCallback((id: string): void => {
    setExpandedConversations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    selectedFolderId,
    selectedFileId,
    expandedConversations,
    selectFolder,
    selectFile,
    toggleConversation,
  };
}
