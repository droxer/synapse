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

export function formatToolPreview(input: Record<string, unknown>): string {
  const first = Object.values(input)[0];
  if (!first) return "";
  const s = typeof first === "string" ? first : JSON.stringify(first);
  return s.length > 40 ? s.slice(0, 37) + "..." : s;
}
