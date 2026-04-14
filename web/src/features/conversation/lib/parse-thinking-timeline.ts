export interface ThinkingTimelineStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly level: number;
  readonly type: "header" | "paragraph";
}

export function parseThinkingTimeline(content: string): ThinkingTimelineStep[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const headerPattern = /^(#{1,3})\s+(.+)$/gm;
  const matches: Array<{ index: number; level: number; title: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerPattern.exec(trimmed)) !== null) {
    matches.push({ index: match.index, level: match[1].length, title: match[2].trim() });
  }

  if (matches.length === 0) {
    return [
      {
        id: "step-1",
        title: "",
        body: trimmed,
        level: 0,
        type: "paragraph",
      },
    ];
  }

  const steps: ThinkingTimelineStep[] = [];
  const firstHeaderIndex = matches[0].index;
  const preamble = firstHeaderIndex > 0 ? trimmed.slice(0, firstHeaderIndex).trim() : "";
  const hasShortPreamble = preamble.length > 0 && preamble.length < 80;
  const hasLongPreamble = preamble.length > 0 && preamble.length >= 80;

  if (hasLongPreamble) {
    steps.push({
      id: "step-0",
      title: "Context",
      body: preamble,
      level: 0,
      type: "paragraph",
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headerLineLength = m.level + 1 + m.title.length + 1; // # + space + title + newline
    const start = m.index + headerLineLength;
    const end = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
    let body = trimmed.slice(start, end).trim();

    if (i === 0 && hasShortPreamble) {
      body = preamble + (body ? "\n\n" + body : "");
    }

    steps.push({
      id: `step-${steps.length + 1}`,
      title: m.title,
      body,
      level: m.level,
      type: "header",
    });
  }

  return steps;
}
