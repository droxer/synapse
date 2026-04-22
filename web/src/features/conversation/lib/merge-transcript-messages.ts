import type { ChatMessage, ThinkingEntry } from "@/shared/types";

function appendUniqueStrings(source: readonly string[] | undefined, additions: readonly string[]): string[] {
  if (!source || source.length === 0) return [...additions];
  const merged = [...source];
  for (const item of additions) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged;
}

function appendUniqueThinkingEntries(
  source: readonly ThinkingEntry[] | undefined,
  additions: readonly ThinkingEntry[],
): ThinkingEntry[] {
  if (!source || source.length === 0) return [...additions];
  const merged = [...source];
  for (const item of additions) {
    const exists = merged.some(
      (entry) =>
        entry.content === item.content &&
        entry.timestamp === item.timestamp &&
        entry.durationMs === item.durationMs,
    );
    if (!exists) {
      merged.push(item);
    }
  }
  return merged;
}

function appendUniqueAttachments(
  source: ChatMessage["attachments"],
  additions: NonNullable<ChatMessage["attachments"]>,
): NonNullable<ChatMessage["attachments"]> {
  if (!source || source.length === 0) return [...additions];
  const merged = [...source];
  for (const item of additions) {
    const exists = merged.some(
      (attachment) =>
        attachment.name === item.name &&
        attachment.size === item.size &&
        attachment.type === item.type,
    );
    if (!exists) {
      merged.push(item);
    }
  }
  return merged;
}

function thinkingEntriesEqual(a: ChatMessage["thinkingEntries"], b: ChatMessage["thinkingEntries"]): boolean {
  if (a === b) return true;
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ae = a[i];
    const be = b[i];
    if (
      ae?.content !== be?.content ||
      ae?.timestamp !== be?.timestamp ||
      ae?.durationMs !== be?.durationMs
    ) {
      return false;
    }
  }
  return true;
}

function stringArraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const MATCH_WINDOW_MS = 30_000;

function normalizeComparableContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

function getBucket(timestamp: number): number {
  return Math.floor(timestamp / MATCH_WINDOW_MS);
}

function areNearbyBuckets(aTimestamp: number, bTimestamp: number): boolean {
  return Math.abs(getBucket(aTimestamp) - getBucket(bTimestamp)) <= 1;
}

function getSharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

interface ContentMatchMetadata {
  readonly exactContent: boolean;
  readonly sharedPrefixLength: number;
}

function getContentMatchMetadata(
  historyMessage: ChatMessage,
  eventDerivedMessage: ChatMessage,
): ContentMatchMetadata | null {
  const historyContent = normalizeComparableContent(historyMessage.content);
  const eventContent = normalizeComparableContent(eventDerivedMessage.content);

  if (historyContent === eventContent) {
    return {
      exactContent: true,
      sharedPrefixLength: historyContent.length,
    };
  }

  if (historyMessage.role !== "assistant" || !historyContent || !eventContent) {
    return null;
  }

  if (historyContent.startsWith(eventContent) || eventContent.startsWith(historyContent)) {
    return {
      exactContent: false,
      sharedPrefixLength: getSharedPrefixLength(historyContent, eventContent),
    };
  }

  return null;
}

interface MatchCandidate {
  readonly index: number;
  readonly exactContent: boolean;
  readonly sharedPrefixLength: number;
  readonly timestampDelta: number;
}

function isBetterMatchCandidate(
  candidate: MatchCandidate,
  currentBest: MatchCandidate | null,
): boolean {
  if (currentBest === null) {
    return true;
  }
  if (candidate.exactContent !== currentBest.exactContent) {
    return candidate.exactContent;
  }
  // Favor the event-derived row whose *time* is closest to the persisted
  // message before preferring a longer text prefix. Otherwise a new reply that
  // continues/extends a prior assistant (same intro) is merged into the
  // *previous* bubble because that row shares more characters with the DB row.
  if (candidate.timestampDelta !== currentBest.timestampDelta) {
    return candidate.timestampDelta < currentBest.timestampDelta;
  }
  if (candidate.sharedPrefixLength !== currentBest.sharedPrefixLength) {
    return candidate.sharedPrefixLength > currentBest.sharedPrefixLength;
  }
  return candidate.index > currentBest.index;
}

/**
 * Reconcile a persisted history row with the matching event-derived bubble.
 *
 * Message IDs are authoritative when they line up. Otherwise we fall back to
 * role + content compatibility, where assistant rows can also match on
 * partial/prefix expansion. A timestamp *bucket* only applies to fuzzy
 * (non-exact) matches — otherwise a refetched `created_at` that differs by
 * minutes from the live event clock still dedupes the same user/assistant line.
 */
function findDuplicateIndex(
  historyMessage: ChatMessage,
  eventDerivedMessages: readonly ChatMessage[],
  claimedIndexes: ReadonlySet<number>,
  minimumIndex: number,
): number | undefined {
  if (historyMessage.messageId) {
    for (let i = Math.max(0, minimumIndex + 1); i < eventDerivedMessages.length; i += 1) {
      if (claimedIndexes.has(i)) continue;
      if (eventDerivedMessages[i]?.messageId === historyMessage.messageId) {
        return i;
      }
    }
  }

  let bestMatch: MatchCandidate | null = null;

  for (let i = Math.max(0, minimumIndex + 1); i < eventDerivedMessages.length; i += 1) {
    if (claimedIndexes.has(i)) continue;

    const candidate = eventDerivedMessages[i]!;
    if (candidate.role !== historyMessage.role) continue;
    if (
      historyMessage.turnId
      && candidate.turnId
      && historyMessage.turnId !== candidate.turnId
    ) {
      continue;
    }

    const contentMatch = getContentMatchMetadata(historyMessage, candidate);
    if (contentMatch === null) continue;

    if (
      !contentMatch.exactContent
      && minimumIndex === -1
      && !areNearbyBuckets(historyMessage.timestamp, candidate.timestamp)
    ) {
      continue;
    }

    const matchCandidate: MatchCandidate = {
      index: i,
      exactContent: contentMatch.exactContent,
      sharedPrefixLength: contentMatch.sharedPrefixLength,
      timestampDelta: Math.abs(historyMessage.timestamp - candidate.timestamp),
    };

    if (isBetterMatchCandidate(matchCandidate, bestMatch)) {
      bestMatch = matchCandidate;
    }
  }

  return bestMatch?.index;
}

/**
 * History may already contain duplicate assistant rows from an older backend
 * bug (e.g. provisional `message_user` text plus terminal completion text for
 * the same turn). If an earlier history row already claimed the matching
 * event-derived bubble, let later compatible history rows merge into that same
 * bubble instead of surviving as transcript orphans after refresh.
 */
function findClaimedDuplicateIndex(
  historyMessage: ChatMessage,
  eventDerivedMessages: readonly ChatMessage[],
  claimedIndexes: ReadonlySet<number>,
  minimumIndex: number,
): number | undefined {
  let bestMatch: MatchCandidate | null = null;

  for (let i = Math.max(0, minimumIndex); i < eventDerivedMessages.length; i += 1) {
    if (!claimedIndexes.has(i)) continue;

    const candidate = eventDerivedMessages[i]!;
    if (candidate.role !== historyMessage.role) continue;
    if (
      historyMessage.turnId
      && candidate.turnId
      && historyMessage.turnId !== candidate.turnId
    ) {
      continue;
    }

    const contentMatch = getContentMatchMetadata(historyMessage, candidate);
    if (contentMatch === null) continue;

    if (
      !contentMatch.exactContent
      && minimumIndex === -1
      && !areNearbyBuckets(historyMessage.timestamp, candidate.timestamp)
    ) {
      continue;
    }

    const matchCandidate: MatchCandidate = {
      index: i,
      exactContent: contentMatch.exactContent,
      sharedPrefixLength: contentMatch.sharedPrefixLength,
      timestampDelta: Math.abs(historyMessage.timestamp - candidate.timestamp),
    };

    if (isBetterMatchCandidate(matchCandidate, bestMatch)) {
      bestMatch = matchCandidate;
    }
  }

  return bestMatch?.index;
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
  const claimedIndexes = new Set<number>();
  const orphans: ChatMessage[] = [];
  let lastMatchedIndex = -1;

  for (const hm of historyMessages) {
    const duplicateIdx = findDuplicateIndex(hm, merged, claimedIndexes, lastMatchedIndex);
    const claimedDuplicateIdx = duplicateIdx === undefined
      ? findClaimedDuplicateIndex(hm, merged, claimedIndexes, lastMatchedIndex)
      : undefined;
    const resolvedDuplicateIdx = duplicateIdx ?? claimedDuplicateIdx;

    if (resolvedDuplicateIdx !== undefined) {
      if (duplicateIdx !== undefined) {
        claimedIndexes.add(duplicateIdx);
      }
      lastMatchedIndex = Math.max(lastMatchedIndex, resolvedDuplicateIdx);
      const existing = merged[resolvedDuplicateIdx]!;
      // Same bubble may appear in both tables; combine extras from either side.
      // History often has the richer row (thinking entries, artifact IDs) while
      // events have the streaming-derived row with partial content.
      const hasNewArtifacts = (hm.imageArtifactIds?.length ?? 0) > 0;
      const hasNewThinking = (hm.thinkingEntries?.length ?? 0) > 0;
      const hasNewThinkingContent = Boolean(hm.thinkingContent && !existing.thinkingContent);
      const hasNewAttachments = (hm.attachments?.length ?? 0) > 0;
      // If history has longer content (final vs streaming partial), prefer it.
      const historyHasFullerContent = hm.content.length > existing.content.length;

      if (hasNewArtifacts || hasNewThinking || hasNewThinkingContent || hasNewAttachments || historyHasFullerContent) {
        const mergedArtifactIds = hasNewArtifacts
          ? appendUniqueStrings(existing.imageArtifactIds, hm.imageArtifactIds!)
          : existing.imageArtifactIds;
        const mergedThinkingEntries = hasNewThinking
          ? appendUniqueThinkingEntries(existing.thinkingEntries, hm.thinkingEntries!)
          : existing.thinkingEntries;
        const mergedThinkingContent = existing.thinkingContent || hm.thinkingContent;
        const mergedAttachments = hasNewAttachments
          ? appendUniqueAttachments(existing.attachments, hm.attachments!)
          : existing.attachments;
        const mergedContent = historyHasFullerContent ? hm.content : existing.content;

        if (
          mergedContent === existing.content &&
          mergedThinkingContent === existing.thinkingContent &&
          mergedAttachments === existing.attachments &&
          stringArraysEqual(mergedArtifactIds, existing.imageArtifactIds) &&
          thinkingEntriesEqual(mergedThinkingEntries, existing.thinkingEntries)
        ) {
          continue;
        }

        merged[resolvedDuplicateIdx] = {
          ...existing,
          content: mergedContent,
          thinkingContent: mergedThinkingContent,
          attachments: mergedAttachments,
          imageArtifactIds: mergedArtifactIds,
          thinkingEntries: mergedThinkingEntries,
        };
      }
    } else {
      orphans.push(hm);
    }
  }

  if (orphans.length === 0) {
    return merged;
  }

  // Insert orphans into the merged array while preserving causal order.
  // The merged array is in event-arrival (causal) order, NOT timestamp order.
  // We find the correct insertion point by locating the nearest event-derived
  // message with a close timestamp and inserting after it, rather than using
  // strict timestamp comparison which breaks when timestamps are non-monotonic.
  orphans.sort((a, b) => a.timestamp - b.timestamp);

  // Build insertion plan first, then apply all at once to avoid index shifting.
  const insertions: Array<{ afterIndex: number; message: ChatMessage }> = [];

  for (const o of orphans) {
    // Find the last message in merged whose timestamp is <= orphan's timestamp.
    // This preserves causal ordering: the orphan goes after the most recent
    // event-derived message that preceded it chronologically.
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const delta = o.timestamp - merged[i]!.timestamp;
      if (delta >= 0 && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    insertions.push({ afterIndex: bestIdx, message: o });
  }

  // Sort insertions by target position (descending) so splicing from the end
  // doesn't shift earlier indices.
  insertions.sort((a, b) => b.afterIndex - a.afterIndex);

  for (const { afterIndex, message } of insertions) {
    if (afterIndex === -1) {
      // Orphan predates all event-derived messages — prepend.
      merged.unshift(message);
    } else {
      merged.splice(afterIndex + 1, 0, message);
    }
  }

  return merged;
}
