"use client";

import { useMemo } from "react";
import { useAppStore } from "@/shared/stores";

/** Drops artifact rows the user removed this session (library or computer panel) so all views stay aligned with the server. */
export function useSessionFilteredArtifacts<T extends { readonly id: string }>(
  items: readonly T[],
): T[] {
  const deletedArtifactIds = useAppStore((s) => s.deletedArtifactIds);
  return useMemo(
    () => items.filter((a) => !deletedArtifactIds[a.id]),
    [items, deletedArtifactIds],
  );
}
