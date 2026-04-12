import type { ChatMessage } from "@/shared/types";

function appendUnique<T>(source: readonly T[] | undefined, additions: readonly T[]): T[] {
  if (!source || source.length === 0) return [...additions];
  return [...source, ...additions];
}

/**
 * Merges DB-persisted transcript rows with event-replayed messages.
 *
 * Event-derived order is canonical: multi-segment assistant turns (e.g. planner /
 * deep-research `llm_response` chunks) only exist in events; the messages table
 * stores the final assistant row. Starting from history and appending non-matching
 * event rows puts those segments after the final answer after a refresh.
 */
export function mergeHistoryWithEventDerivedMessages(
  historyMessages: readonly ChatMessage[],
  eventDerivedMessages: readonly ChatMessage[],
): ChatMessage[] {
  if (eventDerivedMessages.length === 0) {
    return [...historyMessages];
  }

  const merged: ChatMessage[] = [...eventDerivedMessages];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i]!;
    const bucket = Math.floor(m.timestamp / 30_000);
    const key1 = `${m.role}|${bucket}|${m.content}`;
    const key2 = `${m.role}|${bucket + 1}|${m.content}`;
    const key3 = `${m.role}|${bucket - 1}|${m.content}`;
    if (!indexByKey.has(key1)) indexByKey.set(key1, i);
    if (!indexByKey.has(key2)) indexByKey.set(key2, i);
    if (!indexByKey.has(key3)) indexByKey.set(key3, i);
  }

  const orphans: ChatMessage[] = [];

  for (const hm of historyMessages) {
    const bucket = Math.floor(hm.timestamp / 30_000);
    const lookupKey = `${hm.role}|${bucket}|${hm.content}`;
    const duplicateIdx =
      indexByKey.get(lookupKey)
      ?? indexByKey.get(`${hm.role}|${bucket + 1}|${hm.content}`)
      ?? indexByKey.get(`${hm.role}|${bucket - 1}|${hm.content}`);

    if (duplicateIdx !== undefined) {
      const existing = merged[duplicateIdx]!;
      // Same bubble may appear in both tables; combine extras from either side.
      const hasNewArtifacts = (hm.imageArtifactIds?.length ?? 0) > 0;
      const hasNewThinking = (hm.thinkingEntries?.length ?? 0) > 0;
      const hasNewThinkingContent = Boolean(hm.thinkingContent && !existing.thinkingContent);
      if (hasNewArtifacts || hasNewThinking || hasNewThinkingContent) {
        merged[duplicateIdx] = {
          ...existing,
          thinkingContent: existing.thinkingContent || hm.thinkingContent,
          imageArtifactIds: hasNewArtifacts
            ? appendUnique(existing.imageArtifactIds, hm.imageArtifactIds!)
            : existing.imageArtifactIds,
          thinkingEntries: hasNewThinking
            ? appendUnique(existing.thinkingEntries, hm.thinkingEntries!)
            : existing.thinkingEntries,
        };
      }
    } else {
      orphans.push(hm);
    }
  }

  if (orphans.length === 0) {
    return merged;
  }

  orphans.sort((a, b) => a.timestamp - b.timestamp);
  for (const o of orphans) {
    const pos = merged.findIndex((m) => m.timestamp > o.timestamp);
    if (pos === -1) {
      merged.push(o);
    } else {
      merged.splice(pos, 0, o);
    }
  }

  return merged;
}
