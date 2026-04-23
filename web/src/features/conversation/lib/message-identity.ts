import type { HistoryMessage } from "@/features/conversation/api/history-api";
import type { ChatMessage, MessageAttachmentMetadata } from "@/shared/types";

const DEFAULT_MATCH_WINDOW_MS = 5_000;
const INLINE_THINK_PATTERNS = [
  /<redacted_thinking>([\s\S]*?)<\/redacted_thinking>/gi,
  /<redacted_thinking>([\s\S]*?)<\/think>/gi,
  /<think>([\s\S]*?)<\/think>/gi,
  /<thinking>([\s\S]*?)<\/thinking>/gi,
];

function splitAssistantThinking(text: string): { thinkingContent?: string; content: string } {
  const thinkingParts: string[] = [];
  let clean = text;
  for (const re of INLINE_THINK_PATTERNS) {
    clean = clean.replace(re, (_match, inner: string) => {
      const trimmed = inner.trim();
      if (trimmed) thinkingParts.push(trimmed);
      return "";
    });
  }
  const thinkingContent = thinkingParts.join("\n\n").trim();
  return {
    ...(thinkingContent ? { thinkingContent } : {}),
    content: clean.trim(),
  };
}

function normalizeMessageContent(content: HistoryMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object" && "text" in content) {
    return String(content.text);
  }
  return JSON.stringify(content);
}

function isAttachmentMetadata(value: unknown): value is MessageAttachmentMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    Number.isFinite(candidate.size) &&
    typeof candidate.type === "string"
  );
}

export function normalizeMessageAttachments(
  content: HistoryMessage["content"],
): readonly MessageAttachmentMetadata[] | undefined {
  if (!content || typeof content !== "object" || !("attachments" in content)) {
    return undefined;
  }
  const attachments = content.attachments;
  if (!Array.isArray(attachments)) {
    return undefined;
  }
  const normalized = attachments.filter(isAttachmentMetadata);
  return normalized.length > 0 ? normalized : undefined;
}

function mergeStringArrays(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!existing?.length) return incoming;
  if (!incoming?.length) return existing;
  return Array.from(new Set([...existing, ...incoming]));
}

function mergeAttachments(
  existing: ChatMessage["attachments"],
  incoming: ChatMessage["attachments"],
): ChatMessage["attachments"] {
  if (!existing?.length) return incoming;
  if (!incoming?.length) return existing;
  const merged = [...existing];
  for (const attachment of incoming) {
    const alreadyPresent = merged.some(
      (item) =>
        item.name === attachment.name &&
        item.size === attachment.size &&
        item.type === attachment.type,
    );
    if (!alreadyPresent) {
      merged.push(attachment);
    }
  }
  return merged;
}

function mergeMessages(existing: ChatMessage, incoming: ChatMessage): ChatMessage {
  return {
    ...existing,
    ...incoming,
    content: incoming.content || existing.content,
    timestamp: Math.min(existing.timestamp, incoming.timestamp),
    attachments: mergeAttachments(existing.attachments, incoming.attachments),
    imageArtifactIds: mergeStringArrays(existing.imageArtifactIds, incoming.imageArtifactIds),
    thinkingEntries: incoming.thinkingEntries?.length
      ? mergeThinkingEntries(existing.thinkingEntries, incoming.thinkingEntries)
      : existing.thinkingEntries,
    thinkingContent: incoming.thinkingContent || existing.thinkingContent,
    source:
      incoming.source === "history" || incoming.source === "event"
        ? incoming.source
        : existing.source ?? incoming.source,
    turnId: incoming.turnId ?? existing.turnId,
    messageId: incoming.messageId ?? existing.messageId,
  };
}

function mergeThinkingEntries(
  existing: readonly NonNullable<ChatMessage["thinkingEntries"]>[number][] | undefined,
  incoming: readonly NonNullable<ChatMessage["thinkingEntries"]>[number][],
): readonly NonNullable<ChatMessage["thinkingEntries"]>[number][] {
  if (!existing?.length) return incoming;
  const merged = [...existing];
  for (const entry of incoming) {
    const duplicate = merged.some(
      (item) =>
        item.timestamp === entry.timestamp &&
        item.content === entry.content &&
        item.durationMs === entry.durationMs,
    );
    if (!duplicate) {
      merged.push(entry);
    }
  }
  return merged;
}

function areLikelySameMessage(a: ChatMessage, b: ChatMessage): boolean {
  if (a.role !== b.role) return false;
  if (a.content !== b.content) return false;
  return Math.abs(a.timestamp - b.timestamp) <= DEFAULT_MATCH_WINDOW_MS;
}

export function toHistoryChatMessage(message: HistoryMessage): ChatMessage {
  const normalizedContent = normalizeMessageContent(message.content);
  const assistantContent =
    message.role === "assistant"
      ? splitAssistantThinking(normalizedContent)
      : { content: normalizedContent };

  return {
    messageId: `history:${message.id}`,
    role: message.role as "user" | "assistant",
    content: assistantContent.content,
    timestamp: new Date(message.created_at).getTime(),
    source: "history",
    attachments: normalizeMessageAttachments(message.content),
    ...(assistantContent.thinkingContent ? { thinkingContent: assistantContent.thinkingContent } : {}),
  };
}

export function createOptimisticMessageId(
  scopeId: string,
  sequence: number,
): string {
  return `optimistic:${scopeId}:${sequence}`;
}

function normalizeComparableMessageContent(content: string): string {
  return content.trim();
}

function areAttachmentsCompatible(
  optimistic: ChatMessage["attachments"],
  transcript: ChatMessage["attachments"],
): boolean {
  if (!optimistic?.length || !transcript?.length) return true;
  if (optimistic.length !== transcript.length) return false;

  return optimistic.every((attachment) =>
    transcript.some(
      (candidate) =>
        candidate.name === attachment.name &&
        candidate.size === attachment.size &&
        candidate.type === attachment.type,
    ),
  );
}

export interface OptimisticUserMatchState {
  readonly transcriptUserCountAtSend: number;
  readonly transcriptMessageCountAtSend: number;
}

export function reconcileOptimisticConversationMessages(
  transcriptMessages: readonly ChatMessage[],
  localMessages: readonly ChatMessage[],
  optimisticUserMatchState: ReadonlyMap<string, OptimisticUserMatchState>,
): ChatMessage[] {
  if (localMessages.length === 0) {
    return [...transcriptMessages];
  }

  const mergedTranscript = [...transcriptMessages];
  const claimedTranscriptIndexes = new Set<number>();
  const matchedLocalMessageIds = new Set<string>();

  for (let localIndex = localMessages.length - 1; localIndex >= 0; localIndex -= 1) {
    const localMessage = localMessages[localIndex]!;
    if (localMessage.role !== "user" || localMessage.source !== "optimistic" || !localMessage.messageId) {
      continue;
    }

    const matchState = optimisticUserMatchState.get(localMessage.messageId);
    if (!matchState) {
      continue;
    }

    let transcriptUserOrdinal = 0;
    let matched = false;
    for (let transcriptIndex = 0; transcriptIndex < mergedTranscript.length; transcriptIndex += 1) {
      const transcriptMessage = mergedTranscript[transcriptIndex]!;
      if (transcriptMessage.role !== "user") {
        continue;
      }

      const currentOrdinal = transcriptUserOrdinal;
      transcriptUserOrdinal += 1;

      if (currentOrdinal < matchState.transcriptUserCountAtSend) {
        continue;
      }

      if (claimedTranscriptIndexes.has(transcriptIndex)) {
        continue;
      }

      if (
        normalizeComparableMessageContent(transcriptMessage.content) !==
        normalizeComparableMessageContent(localMessage.content)
      ) {
        continue;
      }

      if (!areAttachmentsCompatible(localMessage.attachments, transcriptMessage.attachments)) {
        continue;
      }

      claimedTranscriptIndexes.add(transcriptIndex);
      matchedLocalMessageIds.add(localMessage.messageId);
      mergedTranscript[transcriptIndex] = mergeMessages(localMessage, transcriptMessage);
      matched = true;
      break;
    }

    if (matched) {
      continue;
    }

    // Fallback: when transcript metadata drifts (e.g. replay races), fall back
    // to insertion-index + content matching so optimistic bubbles can still
    // reconcile once their persisted row arrives.
    for (
      let transcriptIndex = Math.max(matchState.transcriptMessageCountAtSend, 0);
      transcriptIndex < mergedTranscript.length;
      transcriptIndex += 1
    ) {
      const transcriptMessage = mergedTranscript[transcriptIndex]!;
      if (transcriptMessage.role !== "user") {
        continue;
      }
      if (claimedTranscriptIndexes.has(transcriptIndex)) {
        continue;
      }
      if (
        normalizeComparableMessageContent(transcriptMessage.content) !==
        normalizeComparableMessageContent(localMessage.content)
      ) {
        continue;
      }
      if (!areAttachmentsCompatible(localMessage.attachments, transcriptMessage.attachments)) {
        continue;
      }
      claimedTranscriptIndexes.add(transcriptIndex);
      matchedLocalMessageIds.add(localMessage.messageId);
      mergedTranscript[transcriptIndex] = mergeMessages(localMessage, transcriptMessage);
      break;
    }
  }

  const unmatchedLocalMessages = localMessages.filter((message) => {
    if (!message.messageId) return true;
    return !matchedLocalMessageIds.has(message.messageId);
  });
  if (unmatchedLocalMessages.length === 0) {
    return mergedTranscript;
  }

  const unmatchedOptimisticUsers = unmatchedLocalMessages
    .map((message, localIndex) => ({ message, localIndex }))
    .filter(({ message }) => message.role === "user" && message.source === "optimistic" && message.messageId)
    .sort((a, b) => {
      const aState = optimisticUserMatchState.get(a.message.messageId!);
      const bState = optimisticUserMatchState.get(b.message.messageId!);
      const aCount = aState?.transcriptMessageCountAtSend ?? Number.MAX_SAFE_INTEGER;
      const bCount = bState?.transcriptMessageCountAtSend ?? Number.MAX_SAFE_INTEGER;
      if (aCount !== bCount) return aCount - bCount;
      return a.localIndex - b.localIndex;
    });

  const nonOptimisticRemainder = unmatchedLocalMessages.filter(
    (message) => !(message.role === "user" && message.source === "optimistic" && message.messageId),
  );

  const orderedMessages: ChatMessage[] = [];
  let unmatchedUserPointer = 0;

  for (let transcriptIndex = 0; transcriptIndex < mergedTranscript.length; transcriptIndex += 1) {
    while (unmatchedUserPointer < unmatchedOptimisticUsers.length) {
      const optimisticEntry = unmatchedOptimisticUsers[unmatchedUserPointer]!;
      const matchState = optimisticUserMatchState.get(optimisticEntry.message.messageId!);
      const insertionIndex = matchState?.transcriptMessageCountAtSend ?? mergedTranscript.length;
      if (insertionIndex > transcriptIndex) {
        break;
      }
      orderedMessages.push(optimisticEntry.message);
      unmatchedUserPointer += 1;
    }

    orderedMessages.push(mergedTranscript[transcriptIndex]!);
  }

  while (unmatchedUserPointer < unmatchedOptimisticUsers.length) {
    orderedMessages.push(unmatchedOptimisticUsers[unmatchedUserPointer]!.message);
    unmatchedUserPointer += 1;
  }

  return [...orderedMessages, ...nonOptimisticRemainder];
}

export function mergeConversationMessages(
  ...collections: ReadonlyArray<readonly ChatMessage[]>
): ChatMessage[] {
  const merged: Array<{ message: ChatMessage; originalIndex: number }> = [];
  const indexById = new Map<string, number>();
  let originalIndex = 0;

  for (const collection of collections) {
    for (const message of collection) {
      const idKey = message.messageId;
      if (idKey !== undefined && idKey.length > 0) {
        const existingIdx = indexById.get(idKey);
        if (existingIdx !== undefined) {
          merged[existingIdx] = {
            ...merged[existingIdx]!,
            message: mergeMessages(merged[existingIdx]!.message, message),
          };
          continue;
        }
      }

      const fallbackIdx = merged.findIndex(({ message: existing }) =>
        areLikelySameMessage(existing, message),
      );
      if (fallbackIdx !== -1) {
        const fallback = merged[fallbackIdx]!;
        const prevKey = fallback.message.messageId;
        if (prevKey !== undefined && prevKey.length > 0) {
          indexById.delete(prevKey);
        }
        merged[fallbackIdx] = {
          ...fallback,
          message: mergeMessages(fallback.message, message),
        };
        if (idKey !== undefined && idKey.length > 0) {
          indexById.set(idKey, fallbackIdx);
        }
        continue;
      }

      merged.push({ message, originalIndex });
      if (idKey !== undefined && idKey.length > 0) {
        indexById.set(idKey, merged.length - 1);
      }
      originalIndex += 1;
    }
  }

  merged.sort((a, b) => {
    const idxDiff = a.originalIndex - b.originalIndex;
    if (idxDiff !== 0) return idxDiff;
    // Tie-break by timestamp for messages that share an insertion index
    return a.message.timestamp - b.message.timestamp;
  });

  return merged.map(({ message }) => message);
}
