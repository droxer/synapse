"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchUserUsage,
  fetchConversationUsage,
  type UserUsageSummary,
  type ConversationUsage,
} from "@/shared/api/usage-api";

export function useUserTokenUsage() {
  const [usage, setUsage] = useState<UserUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchUserUsage();
      setUsage(data);
    } catch {
      // Silently fail — usage is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { usage, loading, refresh };
}

export function useConversationTokenUsage(conversationId: string | null) {
  const [usage, setUsage] = useState<ConversationUsage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setUsage(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchConversationUsage(conversationId)
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return { usage, loading };
}

/** Format a token count to a human-readable string (e.g., 1.2M, 45.3K). */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}
