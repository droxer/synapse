/**
 * Agent computer typography contract:
 * - text-base: panel title
 * - text-sm: top-line row labels and headings
 * - text-sm: tool output body/details
 * - text-micro: badges, counters, metadata chips
 * Keep mono only for IDs/counters/code payloads.
 */
import type { ToolCallInfo } from "@/shared/types";
import {
  OUTPUT_SURFACE_BODY_CLASSES,
  OUTPUT_SURFACE_HEADER_CLASSES,
  OUTPUT_SURFACE_INNER_CLASSES,
  OUTPUT_SURFACE_INNER_DENSE_CLASSES,
  OUTPUT_SURFACE_LABEL_CLASSES,
  OUTPUT_SURFACE_META_CLASSES,
  OUTPUT_SURFACE_ROOT_CLASSES,
} from "@/shared/components/ui/output-surface";
import {
  TOOLING_ACTIVITY_ROW_CLASSES,
  TOOLING_ACTIVITY_ROW_HOVER_CLASSES,
} from "@/shared/lib/tooling-ui-styles";

/** Tool / panel markdown: body tone + spacing; links and code use MarkdownRenderer defaults. */
export const PROSE_CLASSES = "text-sm leading-relaxed text-muted-foreground";
export const TOOL_OUTPUT_MARKDOWN_CLASSES = "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5";
export const OUTPUT_COLLAPSE_THRESHOLD = 500;
export const OUTPUT_CARD_BASE_CLASSES = OUTPUT_SURFACE_ROOT_CLASSES;
export const OUTPUT_CARD_BODY_CLASSES = OUTPUT_SURFACE_BODY_CLASSES;
export const OUTPUT_CARD_INNER_CLASSES = OUTPUT_SURFACE_INNER_CLASSES;
export const OUTPUT_CARD_DENSE_CLASSES = OUTPUT_SURFACE_INNER_DENSE_CLASSES;
export const OUTPUT_HEADER_ROW_CLASSES = OUTPUT_SURFACE_HEADER_CLASSES;
export const OUTPUT_HEADER_LABEL_CLASSES = OUTPUT_SURFACE_LABEL_CLASSES;
export const OUTPUT_META_TEXT_CLASSES = OUTPUT_SURFACE_META_CLASSES;
export const OUTPUT_SCROLL_AREA_CLASSES = "min-h-0 max-h-64 overflow-auto overscroll-contain pr-1";
export const EVENT_ROW_BASE_CLASSES = `surface-panel ${TOOLING_ACTIVITY_ROW_CLASSES}`;
export { ACTIVITY_META_BADGE_CLASSES as EVENT_META_BADGE_CLASSES } from "@/shared/lib/activity-meta-badge";
export const EVENT_LEFT_RAIL_CLASSES = "border-l border-border pl-3";
export const SKILL_TOOL_NAMES = new Set(["activate_skill", "load_skill"]);

export type ActivityEntryKind = "tool" | "skill" | "neutral";

/** Terminal / activity row tone from tool call resolution state. */
export type ToolCallTone = "running" | "complete" | "error";

export function getToolCallTone(tc: ToolCallInfo): ToolCallTone {
  if (tc.success === false) return "error";
  if (tc.success === true || tc.output !== undefined) return "complete";
  return "running";
}

/** Shared hover for activity rows — design guide: border-strong + muted wash (not shadow lift). */
const ACTIVITY_ROW_HOVER = TOOLING_ACTIVITY_ROW_HOVER_CLASSES;

export function getToolCallVisualClasses(tone: ToolCallTone): {
  readonly row: string;
  readonly rowHover: string;
  readonly text: string;
  readonly doneBadge: string;
} {
  switch (tone) {
    case "error":
      return {
        row: "surface-panel border-destructive/60 bg-card",
        rowHover: ACTIVITY_ROW_HOVER,
        text: "text-destructive",
        doneBadge: "status-pill status-error",
      };
    case "complete":
      return {
        row: "surface-panel bg-card",
        rowHover: ACTIVITY_ROW_HOVER,
        text: "text-foreground",
        doneBadge: "status-pill status-neutral",
      };
    default:
      return {
        row: "surface-panel bg-card",
        rowHover: ACTIVITY_ROW_HOVER,
        text: "text-foreground",
        doneBadge: "status-pill status-neutral",
      };
  }
}

interface ActivityKindVisual {
  readonly rowAccent: string;
  readonly rowHoverAccent: string;
}

/** Keep activity rows neutral without accent border highlights. */
const TOOL_ACTIVITY_VISUAL: ActivityKindVisual = {
  rowAccent: "",
  rowHoverAccent: "",
};

const SKILL_ACTIVITY_VISUAL: ActivityKindVisual = {
  rowAccent: "",
  rowHoverAccent: "",
};

const NEUTRAL_ACTIVITY_VISUAL: ActivityKindVisual = {
  rowAccent: "",
  rowHoverAccent: "",
};

export function getActivityEntryKind(toolName: string): ActivityEntryKind {
  return SKILL_TOOL_NAMES.has(toolName) ? "skill" : "tool";
}

export function getActivityKindVisual(kind: ActivityEntryKind): ActivityKindVisual {
  if (kind === "tool") return TOOL_ACTIVITY_VISUAL;
  if (kind === "skill") return SKILL_ACTIVITY_VISUAL;
  return NEUTRAL_ACTIVITY_VISUAL;
}

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
