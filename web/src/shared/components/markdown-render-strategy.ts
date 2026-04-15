export type MarkdownRenderStrategy = "streaming-light" | "streaming-hybrid" | "settled";

export function getMarkdownRenderStrategy(isStreaming?: boolean): MarkdownRenderStrategy {
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

function isTableLikeLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|");
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function hasTrailingBlankBlock(content: string): boolean {
  return /\n\s*\n\s*$/.test(content);
}

function getTrailingUnstableStartLine(lines: readonly string[], content: string): number | null {
  const lastNonEmptyLine = lines.findLastIndex((line) => line.trim().length > 0);
  if (lastNonEmptyLine === -1) return null;
  if (hasTrailingBlankBlock(content)) return null;

  if (isTableLikeLine(lines[lastNonEmptyLine])) {
    let start = lastNonEmptyLine;
    while (start > 0 && lines[start - 1].trim().length > 0 && isTableLikeLine(lines[start - 1])) {
      start -= 1;
    }
    const blockLines = lines.slice(start, lastNonEmptyLine + 1);
    if (blockLines.some(isTableDelimiterLine)) {
      return start;
    }
  }

  let start = lastNonEmptyLine;
  while (start > 0 && lines[start - 1].trim().length > 0) {
    start -= 1;
  }
  return start;
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
  const unstableStartLine = unclosedFenceStartLine ?? getTrailingUnstableStartLine(lines, content);

  if (unstableStartLine === null) {
    return { stableContent: content, tailContent: "" };
  }

  const splitOffset = lineStartOffsets[unstableStartLine] ?? 0;
  return {
    stableContent: content.slice(0, splitOffset),
    tailContent: content.slice(splitOffset),
  };
}
