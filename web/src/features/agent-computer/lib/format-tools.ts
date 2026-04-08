/**
 * Agent computer typography contract:
 * - text-base: panel title
 * - text-sm: top-line row labels and headings
 * - text-sm: tool output body/details
 * - text-micro: badges, counters, metadata chips
 * Keep mono only for IDs/counters/code payloads.
 */
/** Tool / panel markdown: body tone + spacing; links and code use MarkdownRenderer defaults. */
export const PROSE_CLASSES = "text-sm leading-relaxed text-muted-foreground";
export const TOOL_OUTPUT_MARKDOWN_CLASSES = "";
export const OUTPUT_CARD_BASE_CLASSES = "mt-2 rounded-md border border-border/70 bg-muted/50 px-3 py-2";
export const OUTPUT_HEADER_ROW_CLASSES = "mb-1.5 flex items-center gap-1.5";
export const OUTPUT_HEADER_LABEL_CLASSES = "text-xs font-medium text-muted-foreground";
export const OUTPUT_META_TEXT_CLASSES = "text-micro text-muted-foreground-dim";

export function formatInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .slice(0, 2)
    .map(([key, value]) => {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = strValue.length > 40 ? strValue.slice(0, 37) + "..." : strValue;
      return `--${key}="${truncated}"`;
    })
    .join(" ");
}

export function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function formatToolPreview(input: Record<string, unknown>): string {
  const first = Object.values(input)[0];
  if (!first) return "";
  const s = typeof first === "string" ? first : JSON.stringify(first);
  return s.length > 40 ? s.slice(0, 37) + "..." : s;
}
