import { Package, Globe, FolderGit2 } from "lucide-react";

/**
 * Source labels are **metadata** (where the skill comes from), not run state.
 * Pair `className` with `ACTIVITY_META_BADGE_CLASSES` from `@/shared/lib/activity-meta-badge`
 * (same shell as tool “done” / counts in the agent panel).
 */
export const SOURCE_STYLE = {
  bundled: { icon: Package, className: "text-accent-emerald" },
  user: { icon: Globe, className: "text-focus" },
  project: { icon: FolderGit2, className: "text-accent-amber" },
} as const;

export const SOURCE_LABEL_KEY: Record<string, string> = {
  bundled: "skills.source.bundled",
  user: "skills.source.user",
  project: "skills.source.project",
};
