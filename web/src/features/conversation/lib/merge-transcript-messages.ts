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

function isCoveredByFullerEventAssistant(
  historyMessage: ChatMessage,
  eventDerivedMessages: readonly ChatMessage[],
  minimumIndex: number,
): boolean {
  if (historyMessage.role !== "assistant") {
    return false;
  }
  if (minimumIndex < 0) {
    return false;
  }
  const historyContent = normalizeComparableContent(historyMessage.content);
  if (!historyContent) {
    return false;
  }

  for (let i = Math.max(0, minimumIndex + 1); i < eventDerivedMessages.length; i += 1) {
    const candidate = eventDerivedMessages[i]!;
    if (candidate.role !== "assistant") {
      continue;
    }
    const candidateContent = normalizeComparableContent(candidate.content);
    if (candidateContent.length <= historyContent.length * 1.25) {
      continue;
    }
    if (historyMessage.timestamp < candidate.timestamp) {
      continue;
    }
    if (!areNearbyBuckets(historyMessage.timestamp, candidate.timestamp)) {
      continue;
    }
    return true;
  }

  return false;
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
  const historyMergeEntries: Array<
    | { kind: "matched"; index: number }
    | { kind: "orphan"; message: ChatMessage }
  > = [];
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
      historyMergeEntries.push({ kind: "matched", index: resolvedDuplicateIdx });
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
    } else if (isCoveredByFullerEventAssistant(hm, merged, lastMatchedIndex)) {
      historyMergeEntries.push({ kind: "matched", index: lastMatchedIndex });
    } else {
      orphans.push(hm);
      historyMergeEntries.push({ kind: "orphan", message: hm });
    }
  }

  if (orphans.length === 0) {
    return merged;
  }

  // Insert orphans into the merged array while preserving history anchors first.
  // This avoids trailing persisted rows (e.g. a deep-research final report) from
  // being inserted into the middle of later event-only steps when timestamps are
  // non-monotonic. We only fall back to timestamp placement if no history row
  // matched the event-derived transcript at all.
  const orphanInsertionsBefore = new Map<number, ChatMessage[]>();
  const appendAtEnd: ChatMessage[] = [];
  const fallbackTimestampOrphans: ChatMessage[] = [];

  for (let i = 0; i < historyMergeEntries.length; i += 1) {
    const entry = historyMergeEntries[i]!;
    if (entry.kind !== "orphan") {
      continue;
    }

    let nextMatchedIndex: number | null = null;
    for (let j = i + 1; j < historyMergeEntries.length; j += 1) {
      const candidate = historyMergeEntries[j]!;
      if (candidate.kind === "matched") {
        nextMatchedIndex = candidate.index;
        break;
      }
    }

    let hasPreviousMatch = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (historyMergeEntries[j]!.kind === "matched") {
        hasPreviousMatch = true;
        break;
      }
    }

    if (nextMatchedIndex !== null) {
      const bucket = orphanInsertionsBefore.get(nextMatchedIndex) ?? [];
      bucket.push(entry.message);
      orphanInsertionsBefore.set(nextMatchedIndex, bucket);
      continue;
    }

    if (hasPreviousMatch) {
      appendAtEnd.push(entry.message);
      continue;
    }

    fallbackTimestampOrphans.push(entry.message);
  }

  const rebuilt: ChatMessage[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const bucket = orphanInsertionsBefore.get(i);
    if (bucket) {
      rebuilt.push(...bucket);
    }
    rebuilt.push(merged[i]!);
  }
  rebuilt.push(...appendAtEnd);

  if (fallbackTimestampOrphans.length === 0) {
    return rebuilt;
  }

  // No history rows matched any event-derived message. Fall back to timestamp
  // placement so wholly legacy rows still land in a sensible position.
  const result = [...rebuilt];
  fallbackTimestampOrphans.sort((a, b) => a.timestamp - b.timestamp);
  const insertions: Array<{ afterIndex: number; message: ChatMessage }> = [];

  for (const orphan of fallbackTimestampOrphans) {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < result.length; i += 1) {
      const delta = orphan.timestamp - result[i]!.timestamp;
      if (delta >= 0 && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    insertions.push({ afterIndex: bestIdx, message: orphan });
  }

  insertions.sort((a, b) => b.afterIndex - a.afterIndex);

  for (const { afterIndex, message } of insertions) {
    if (afterIndex === -1) {
      result.unshift(message);
    } else {
      result.splice(afterIndex + 1, 0, message);
    }
  }

  return result;
}
