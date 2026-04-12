import { Package, Globe, FolderGit2 } from "lucide-react";

export const SOURCE_STYLE = {
  bundled: { icon: Package, className: "border border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald" },
  user: { icon: Globe, className: "border border-focus/30 bg-focus/10 text-focus" },
  project: { icon: FolderGit2, className: "border border-accent-amber/30 bg-accent-amber/10 text-accent-amber" },
} as const;

export const SOURCE_LABEL_KEY: Record<string, string> = {
  bundled: "skills.source.bundled",
  user: "skills.source.user",
  project: "skills.source.project",
};
