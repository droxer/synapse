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

function findTrailingEmphasisStart(content: string): number | null {
  const lines = content.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const markerMatch = /(.*?)(\*\*|__|\*|_)([^*_]*)$/.exec(lastLine);
  if (!markerMatch) return null;

  const [, prefix, marker, suffix] = markerMatch;
  const closingPattern = new RegExp(`${marker.replace(/([*_])/g, "\\$1")}`);
  if (closingPattern.test(suffix)) return null;

  const offset = content.length - lastLine.length;
  return offset + prefix.length;
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
  const unstableOffsets = [
    unclosedFenceStartLine === null ? null : (lineStartOffsets[unclosedFenceStartLine] ?? 0),
    findTrailingInlineCodeStart(content),
    findTrailingLinkStart(content),
    findTrailingEmphasisStart(content),
  ].filter((value): value is number => value !== null);

  if (unstableOffsets.length === 0) {
    return { stableContent: content, tailContent: "" };
  }

  const splitOffset = Math.min(...unstableOffsets);
  return {
    stableContent: content.slice(0, splitOffset),
    tailContent: content.slice(splitOffset),
  };
}
