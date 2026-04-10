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
export const TOOL_OUTPUT_MARKDOWN_CLASSES = "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5";
export const OUTPUT_COLLAPSE_THRESHOLD = 500;
export const OUTPUT_CARD_BASE_CLASSES = "mt-2 rounded-lg border border-border-strong bg-background/70 px-3 py-2";
export const OUTPUT_CARD_DENSE_CLASSES = "rounded-md bg-muted/15 px-2 py-1.5";
export const OUTPUT_HEADER_ROW_CLASSES = "mb-2 flex items-center gap-1.5";
export const OUTPUT_HEADER_LABEL_CLASSES = "text-sm font-medium text-muted-foreground";
export const OUTPUT_META_TEXT_CLASSES = "text-micro text-muted-foreground-dim";
export const EVENT_ROW_BASE_CLASSES = "rounded-md border border-border-strong bg-background/60 px-3 py-2";
export const EVENT_META_BADGE_CLASSES = "inline-flex items-center rounded-md bg-muted/20 px-1.5 py-0.5 text-micro font-medium text-muted-foreground";
export const EVENT_LEFT_RAIL_CLASSES = "border-l border-border pl-2.5";

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
