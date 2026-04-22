export type MarkdownRenderStrategy = "streaming-light" | "streaming-hybrid" | "settled";

export function getMarkdownRenderStrategy(isStreaming?: boolean): MarkdownRenderStrategy {
  // Default to hybrid rendering while streaming so complete markdown blocks
  // (headings, lists, fenced code, links) stay accurate in live view while
  // keeping only the unfinished tail lightweight.
  return isStreaming ? "streaming-hybrid" : "settled";
}

export interface StreamingMarkdownSegments {
  readonly stableContent: string;
  readonly tailContent: string;
}

interface FenceState {
  readonly markerChar: "`" | "~";
  readonly markerLength: number;
  readonly startLine: number;
}

const FENCE_OPEN_RE = /^ {0,3}([`~]{3,})(.*)$/;

function isClosingFence(line: string, fence: FenceState): boolean {
  const closingFence = new RegExp(`^ {0,3}${fence.markerChar}{${fence.markerLength},}\\s*$`);
  return closingFence.test(line);
}

function findUnclosedFenceStartLine(lines: readonly string[]): number | null {
  let openFence: FenceState | null = null;

  for (const [index, line] of lines.entries()) {
    if (openFence) {
      if (isClosingFence(line, openFence)) {
        openFence = null;
      }
      continue;
    }

    const match = FENCE_OPEN_RE.exec(line);
    if (!match) continue;

    openFence = {
      markerChar: match[1][0] as "`" | "~",
      markerLength: match[1].length,
      startLine: index,
    };
  }

  return openFence?.startLine ?? null;
}

function findTrailingInlineCodeStart(content: string): number | null {
  let unmatchedIndex: number | null = null;
  let i = 0;

  while (i < content.length) {
    if (content[i] !== "`") {
      i += 1;
      continue;
    }

    let j = i;
    while (content[j] === "`") j += 1;
    const markerLength = j - i;
    const marker = "`".repeat(markerLength);
    const closeIndex = content.indexOf(marker, j);
    if (closeIndex === -1) {
      unmatchedIndex = i;
      break;
    }
    i = closeIndex + markerLength;
  }

  return unmatchedIndex;
}

function findTrailingLinkStart(content: string): number | null {
  const imageMatch = /!\[[^\]]*$/.exec(content);
  const linkMatch = /\[[^\]]*$/.exec(content);
  const parenMatch = /\[[^\]]+\]\([^)]*$/.exec(content);

  const candidates = [imageMatch?.index, linkMatch?.index, parenMatch?.index]
    .filter((value): value is number => value !== undefined);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

function isEscaped(content: string, index: number): boolean {
  let backslashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && content[cursor] === "\\") {
    backslashCount += 1;
    cursor -= 1;
  }

  return backslashCount % 2 === 1;
}

function isWhitespace(char: string): boolean {
  return char.length === 0 || /\s/.test(char);
}

function isAlphaNumeric(char: string): boolean {
  return /[0-9A-Za-z]/.test(char);
}

interface EmphasisToken {
  readonly marker: "*" | "_" | "**" | "__";
  readonly index: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

function canOpenEmphasis(markerChar: "*" | "_", prev: string, next: string): boolean {
  if (isWhitespace(next)) return false;
  if (markerChar === "_" && isAlphaNumeric(prev) && isAlphaNumeric(next)) return false;
  return !isAlphaNumeric(prev);
}

function canCloseEmphasis(markerChar: "*" | "_", prev: string, next: string): boolean {
  if (isWhitespace(prev)) return false;
  if (markerChar === "_" && isAlphaNumeric(prev) && isAlphaNumeric(next)) return false;
  return !isAlphaNumeric(next);
}

function findTrailingEmphasisStart(content: string): number | null {
  const lines = content.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const offset = content.length - lastLine.length;
  const tokens: EmphasisToken[] = [];

  for (let i = 0; i < lastLine.length; ) {
    const char = lastLine[i];
    if ((char !== "*" && char !== "_") || isEscaped(lastLine, i)) {
      i += 1;
      continue;
    }

    let runLength = 1;
    while (lastLine[i + runLength] === char) {
      runLength += 1;
    }

    let consumed = 0;
    let remaining = runLength;
    while (remaining > 0) {
      const markerLength = remaining >= 2 ? 2 : 1;
      const marker = char.repeat(markerLength) as EmphasisToken["marker"];
      const index = i + consumed;
      const prev = index > 0 ? lastLine[index - 1] ?? "" : "";
      const next = lastLine[index + markerLength] ?? "";
      tokens.push({
        marker,
        index,
        canOpen: canOpenEmphasis(char, prev, next),
        canClose: canCloseEmphasis(char, prev, next),
      });
      consumed += markerLength;
      remaining -= markerLength;
    }

    i += runLength;
  }

  if (tokens.length === 0) return null;

  const unmatchedOpeners: EmphasisToken[] = [];
  for (const token of tokens) {
    if (token.canClose) {
      let openerIndex = -1;
      for (let i = unmatchedOpeners.length - 1; i >= 0; i -= 1) {
        if (unmatchedOpeners[i]?.marker === token.marker) {
          openerIndex = i;
          break;
        }
      }
      if (openerIndex !== -1) {
        unmatchedOpeners.splice(openerIndex, 1);
        continue;
      }
    }

    if (token.canOpen) {
      unmatchedOpeners.push(token);
    }
  }

  if (unmatchedOpeners.length === 0) return null;
  return offset + Math.min(...unmatchedOpeners.map((token) => token.index));
}

function isListMarker(line: string): boolean {
  return /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line);
}

function isHeadingMarker(line: string): boolean {
  return /^ {0,3}#{1,6}\s+/.test(line);
}

function isBlockquoteMarker(line: string): boolean {
  return /^ {0,3}>\s?/.test(line);
}

function isTableBlock(lines: readonly string[], startIndex: number): boolean {
  const header = lines[startIndex]?.trim() ?? "";
  const separator = lines[startIndex + 1]?.trim() ?? "";
  if (!header.includes("|")) return false;
  return /^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/.test(separator);
}

function isStructuredTrailingBlock(lines: readonly string[], startIndex: number): boolean {
  const line = lines[startIndex] ?? "";
  return (
    FENCE_OPEN_RE.test(line) ||
    isHeadingMarker(line) ||
    isListMarker(line) ||
    isBlockquoteMarker(line) ||
    isTableBlock(lines, startIndex) ||
    /^ {4,}\S/.test(line)
  );
}

function findTrailingParagraphStart(
  lines: readonly string[],
  lineStartOffsets: readonly number[],
): number | null {
  let endIndex = lines.length - 1;
  while (endIndex >= 0 && lines[endIndex]?.trim() === "") {
    endIndex -= 1;
  }
  if (endIndex < 0) return null;

  const contentEndsWithNewline = lines[lines.length - 1] === "";
  if (contentEndsWithNewline) return null;

  let startIndex = endIndex;
  while (startIndex > 0 && lines[startIndex - 1]?.trim() !== "") {
    startIndex -= 1;
  }

  if (isStructuredTrailingBlock(lines, startIndex)) {
    return null;
  }

  return lineStartOffsets[startIndex] ?? 0;
}

export function splitStreamingMarkdown(content: string): StreamingMarkdownSegments {
  if (!content) {
    return { stableContent: "", tailContent: "" };
  }

  const lines = content.split("\n");
  const lineStartOffsets: number[] = [];
  let offset = 0;

  for (const line of lines) {
    lineStartOffsets.push(offset);
    offset += line.length + 1;
  }

  const unclosedFenceStartLine = findUnclosedFenceStartLine(lines);
  const syntaxUnstableOffsets = [
    unclosedFenceStartLine === null ? null : (lineStartOffsets[unclosedFenceStartLine] ?? 0),
    findTrailingInlineCodeStart(content),
    findTrailingLinkStart(content),
    findTrailingEmphasisStart(content),
  ].filter((value): value is number => value !== null);

  const unstableOffsets = syntaxUnstableOffsets.length > 0
    ? syntaxUnstableOffsets
    : [findTrailingParagraphStart(lines, lineStartOffsets)].filter((value): value is number => value !== null);

  if (unstableOffsets.length === 0) {
    return { stableContent: content, tailContent: "" };
  }

  const splitOffset = Math.min(...unstableOffsets);
  return {
    stableContent: content.slice(0, splitOffset),
    tailContent: content.slice(splitOffset),
  };
}
