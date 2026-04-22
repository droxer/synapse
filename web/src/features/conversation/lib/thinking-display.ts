import type { Locale } from "@/i18n";

interface ThinkingEntryLike {
  readonly content: string;
}

export interface ThinkingDisplaySelection<TEntry extends ThinkingEntryLike> {
  readonly entries: readonly TEntry[];
  readonly thinkingContent?: string;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownFormatting(value: string): string {
  return value
    .replace(/^[>\s]*[-*+]\s+/gm, "")
    .replace(/^[>\s]*\d+[.)]\s+/gm, "")
    .replace(/^[>\s]*#{1,6}\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .trim();
}

function normalizeComparableThinking(value: string): string {
  return collapseWhitespace(stripMarkdownFormatting(value));
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value);
}

function hasLatin(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function prefersThinkingContentForLocale(
  locale: Locale,
  entryText: string,
  thinkingContent: string,
): boolean {
  if (locale.startsWith("zh")) {
    return hasCjk(thinkingContent) && !hasCjk(entryText);
  }

  if (locale === "en") {
    return hasLatin(thinkingContent) && !hasLatin(entryText);
  }

  return false;
}

export function isThinkingContentRedundantWithEntries(
  thinkingContent: string | undefined,
  entries: readonly ThinkingEntryLike[] | undefined,
): boolean {
  const trimmed = thinkingContent?.trim();
  if (!trimmed || !entries?.length) return false;

  const combined = entries
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!combined) return false;
  if (trimmed === combined) return true;

  return normalizeComparableThinking(trimmed) === normalizeComparableThinking(combined);
}

export function selectThinkingDisplay<TEntry extends ThinkingEntryLike>(
  locale: Locale,
  entries: readonly TEntry[] | undefined,
  thinkingContent: string | undefined,
): ThinkingDisplaySelection<TEntry> {
  const normalizedEntries = entries ?? [];
  const trimmedThinkingContent = thinkingContent?.trim();

  if (!trimmedThinkingContent) {
    return { entries: normalizedEntries };
  }

  if (!normalizedEntries.length) {
    return { entries: normalizedEntries, thinkingContent: trimmedThinkingContent };
  }

  if (isThinkingContentRedundantWithEntries(trimmedThinkingContent, normalizedEntries)) {
    return { entries: normalizedEntries };
  }

  const joinedEntries = normalizedEntries
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .join("\n\n");

  if (prefersThinkingContentForLocale(locale, joinedEntries, trimmedThinkingContent)) {
    return { entries: [], thinkingContent: trimmedThinkingContent };
  }

  return { entries: normalizedEntries, thinkingContent: trimmedThinkingContent };
}
