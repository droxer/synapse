"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/shared/stores";
import type { LibraryGroup } from "../types";
import { fetchLibrary } from "../api/library-api";

const PAGE_SIZE = 20;

export function useLibrary() {
  const libraryRefetchEpoch = useAppStore((s) => s.libraryRefetchEpoch);
  const [groups, setGroups] = useState<readonly LibraryGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const initialLibraryFetchDone = useRef(false);

  const load = useCallback(
    async (currentOffset: number, append: boolean, options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await fetchLibrary(PAGE_SIZE, currentOffset);
        setGroups((prev) =>
          append ? [...prev, ...data.groups] : data.groups,
        );
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load library");
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setOffset(0);
    const silent = initialLibraryFetchDone.current;
    let cancelled = false;
    void (async () => {
      await load(0, false, { silent });
      if (!cancelled) initialLibraryFetchDone.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [load, libraryRefetchEpoch]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    load(nextOffset, true);
  }, [offset, load]);

  const hasMore = groups.length < total;

  const removeArtifactsById = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setGroups((prev) =>
      prev
        .map((g) => ({
          ...g,
          artifacts: g.artifacts.filter((a) => !idSet.has(a.id)),
        }))
        .filter((g) => g.artifacts.length > 0),
    );
  }, []);

  const filtered = filter
    ? groups
        .map((g) => {
          const matchTitle = g.title
            ?.toLowerCase()
            .includes(filter.toLowerCase());
          const matchingArtifacts = g.artifacts.filter((a) =>
            a.name.toLowerCase().includes(filter.toLowerCase()),
          );
          if (matchTitle) return g;
          if (matchingArtifacts.length > 0)
            return { ...g, artifacts: matchingArtifacts };
          return null;
        })
        .filter((g): g is LibraryGroup => g !== null)
    : groups;

  return {
    groups: filtered,
    total,
    isLoading,
    error,
    filter,
    setFilter,
    loadMore,
    hasMore,
    removeArtifactsById,
  };
}
