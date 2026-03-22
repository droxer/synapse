"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchUserConversationUsage,
  type ConversationUsage,
} from "@/shared/api/usage-api";

const PAGE_SIZE = 10;

export function useConversationUsageList() {
  const [items, setItems] = useState<readonly ConversationUsage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const loadPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserConversationUsage(
        PAGE_SIZE,
        targetPage * PAGE_SIZE,
      );
      setItems(data.items);
      setTotal(data.total);
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return { items, total, loading, error, page, totalPages, loadPage };
}
