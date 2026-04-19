export function renderMarkdown(text: string, width: number): string[] {
  const safeWidth = Math.max(8, width);
  const sourceLines = text.replace(/\r\n/g, "\n").split("\n");
  const rendered: string[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index] ?? "";

    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < sourceLines.length && !/^\s*```/.test(sourceLines[index] ?? "")) {
        codeLines.push(sourceLines[index] ?? "");
        index += 1;
      }
      rendered.push(...renderCodeBlock(codeLines, language, safeWidth));
      continue;
    }

    if (/^\s*$/.test(line)) {
      rendered.push("");
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const title = renderInlineMarkdown(heading[2] ?? "");
      const headingPrefix = `${"#".repeat(level)} `;
      rendered.push(...wrapWithPrefix(title, safeWidth, headingPrefix, headingPrefix));
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      rendered.push("-".repeat(Math.max(8, Math.min(safeWidth, 24))));
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      rendered.push(...wrapWithPrefix(renderInlineMarkdown(quote[1] ?? ""), safeWidth, "> ", "  "));
      continue;
    }

    const ordered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ordered) {
      const indent = ordered[1] ?? "";
      const marker = `${indent}${ordered[2]}. `;
      rendered.push(
        ...wrapWithPrefix(
          renderInlineMarkdown(ordered[3] ?? ""),
          safeWidth,
          marker,
          `${" ".repeat(marker.length)}`,
        ),
      );
      continue;
    }

    const unordered = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (unordered) {
      const indent = unordered[1] ?? "";
      const marker = `${indent}- `;
      rendered.push(
        ...wrapWithPrefix(
          renderInlineMarkdown(unordered[2] ?? ""),
          safeWidth,
          marker,
          `${" ".repeat(marker.length)}`,
        ),
      );
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      rendered.push(...wrapWithPrefix(renderInlineMarkdown(line.trim()), safeWidth, "", ""));
      continue;
    }

    rendered.push(...wrapWithPrefix(renderInlineMarkdown(line), safeWidth, "", ""));
  }

  return collapseBlankLines(rendered);
}

function renderCodeBlock(
  lines: string[],
  language: string,
  width: number,
): string[] {
  const rendered = [`[code${language ? `:${language}` : ""}]`];
  if (lines.length === 0) {
    rendered.push("  ");
    return rendered;
  }

  for (const line of lines) {
    const normalized = line.replace(/\t/g, "  ");
    rendered.push(...wrapWithPrefix(normalized, width, "  ", "  ", false));
  }
  return rendered;
}

function renderInlineMarkdown(text: string): string {
  let rendered = text;
  rendered = rendered.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 <$2>");
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 <$2>");
  rendered = rendered.replace(/`([^`]+)`/g, "'$1'");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "$1");
  rendered = rendered.replace(/__([^_]+)__/g, "$1");
  rendered = rendered.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
  rendered = rendered.replace(/(?<!_)_([^_]+)_(?!_)/g, "$1");
  rendered = rendered.replace(/~~([^~]+)~~/g, "$1");
  return rendered;
}

function wrapWithPrefix(
  text: string,
  width: number,
  firstPrefix: string,
  restPrefix: string,
  wordWrap = true,
): string[] {
  const firstWidth = Math.max(1, width - firstPrefix.length);
  const restWidth = Math.max(1, width - restPrefix.length);
  const chunks = wordWrap ? wrapText(text, firstWidth, restWidth) : wrapVerbatim(text, firstWidth, restWidth);
  return chunks.map((chunk, index) => `${index === 0 ? firstPrefix : restPrefix}${chunk}`);
}

function wrapText(text: string, firstWidth: number, restWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let current = "";
    let currentWidth = firstWidth;
    const words = paragraph.split(/\s+/);

    for (const word of words) {
      if (!current) {
        current = word;
        currentWidth = restWidth;
        continue;
      }

      if (`${current} ${word}`.length <= currentWidth) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
        currentWidth = restWidth;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [""];
}

function wrapVerbatim(text: string, firstWidth: number, restWidth: number): string[] {
  const lines: string[] = [];
  let currentWidth = firstWidth;
  let remaining = text;

  if (!remaining) {
    return [""];
  }

  while (remaining.length > currentWidth) {
    lines.push(remaining.slice(0, currentWidth));
    remaining = remaining.slice(currentWidth);
    currentWidth = restWidth;
  }

  lines.push(remaining);
  return lines;
}

function collapseBlankLines(lines: string[]): string[] {
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === "" && collapsed.at(-1) === "") {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed;
}
