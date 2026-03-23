"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchMemoryEntries,
  deleteMemoryEntry as apiDeleteMemoryEntry,
  type MemoryEntry,
} from "@/shared/api/memory-api";

const PAGE_SIZE = 10;

export function useMemoryEntries() {
  const [items, setItems] = useState<readonly MemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const loadPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemoryEntries(
        PAGE_SIZE,
        targetPage * PAGE_SIZE,
      );
      setItems(data.items);
      setTotal(data.total);
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory entries");
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteEntry = useCallback(async (entryId: string) => {
    try {
      await apiDeleteMemoryEntry(entryId);
      // Reload current page after deletion
      const data = await fetchMemoryEntries(PAGE_SIZE, page * PAGE_SIZE);
      setItems(data.items);
      setTotal(data.total);
      // If current page is now empty and not the first page, go back
      if (data.items.length === 0 && page > 0) {
        await loadPage(page - 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory entry");
    }
  }, [page, loadPage]);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return { items, total, loading, error, page, totalPages, loadPage, deleteEntry };
}
