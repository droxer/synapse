import { Package, Globe, FolderGit2 } from "lucide-react";

export const SOURCE_STYLE = {
  bundled: { icon: Package, className: "border border-border bg-muted text-muted-foreground" },
  user: { icon: Globe, className: "border border-border bg-muted text-muted-foreground" },
  project: { icon: FolderGit2, className: "border border-border bg-muted text-muted-foreground" },
} as const;

export const SOURCE_LABEL_KEY: Record<string, string> = {
  bundled: "skills.source.bundled",
  user: "skills.source.user",
  project: "skills.source.project",
};
