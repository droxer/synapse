/**
 * Agent computer typography contract:
 * - text-base: panel title
 * - text-sm: top-line row labels and headings
 * - text-sm: tool output body/details
 * - text-micro: badges, counters, metadata chips
 * Keep mono only for IDs/counters/code payloads.
 */
export const PROSE_CLASSES = "text-sm leading-relaxed text-muted-foreground [&_a]:text-user-accent [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:pl-4 [&_p]:my-1 [&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:my-1 [&_ul]:pl-4";
export const TOOL_OUTPUT_MARKDOWN_CLASSES = "";
export const OUTPUT_CARD_BASE_CLASSES = "mt-2.5 rounded-md border-l-2 border-l-border-strong bg-muted px-2.5 py-1.5";
export const OUTPUT_HEADER_ROW_CLASSES = "mb-1.5 flex items-center gap-2";
export const OUTPUT_HEADER_LABEL_CLASSES = "text-sm font-medium text-foreground";
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
