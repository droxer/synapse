import type { HistoryMessage } from "@/features/conversation/api/history-api";
import type { ChatMessage } from "@/shared/types";

const DEFAULT_MATCH_WINDOW_MS = 5_000;

function normalizeMessageContent(content: HistoryMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object" && "text" in content) {
    return String(content.text);
  }
  return JSON.stringify(content);
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
  return {
    messageId: `history:${message.id}`,
    role: message.role as "user" | "assistant",
    content: normalizeMessageContent(message.content),
    timestamp: new Date(message.created_at).getTime(),
    source: "history",
  };
}

export function createOptimisticMessageId(
  scopeId: string,
  sequence: number,
): string {
  return `optimistic:${scopeId}:${sequence}`;
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
    if (a.message.timestamp === b.message.timestamp) {
      return a.originalIndex - b.originalIndex;
    }
    return a.message.timestamp - b.message.timestamp;
  });

  return merged.map(({ message }) => message);
}
