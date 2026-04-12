/**
 * Converts a kebab-case (or similar) skill name to a human-readable English title.
 * e.g. "data-analysis" → "Data Analysis", "WEB_RESEARCH" → "Web Research"
 *
 * ASCII alphanumeric segments are title-cased (first letter upper, rest lower).
 * Non-ASCII segments (e.g. CJK) are left unchanged.
 */
export function normalizeSkillName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split(/[-_./\s]+/)
    .filter(Boolean)
    .map((token) => {
      if (!/^[a-zA-Z0-9]+$/.test(token)) {
        return token;
      }
      if (!/^[a-zA-Z]/.test(token)) {
        return token;
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}
