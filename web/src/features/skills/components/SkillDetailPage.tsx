"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Lightbulb,
  Trash2,
  Package,
  FolderGit2,
  Globe,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { MarkdownRenderer } from "@/shared/components/MarkdownRenderer";
import { cn } from "@/shared/lib/utils";
import { useSkillsCache } from "../hooks/use-skills-cache";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import { uninstallSkill } from "../api/skills-api";
import { useTranslation } from "@/i18n";

const sourceStyle = {
  bundled: { icon: Package, className: "bg-secondary text-muted-foreground" },
  user: { icon: Globe, className: "bg-accent-emerald/10 text-accent-emerald" },
  project: {
    icon: FolderGit2,
    className: "bg-accent-purple/10 text-accent-purple",
  },
} as const;

const SOURCE_LABEL_KEY: Record<string, string> = {
  bundled: "skills.source.bundled",
  user: "skills.source.user",
  project: "skills.source.project",
};

interface SkillDetailPageProps {
  readonly name: string;
}

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header skeleton */}
      <div className="shrink-0 border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <div className="h-8 w-8 skeleton-shimmer rounded-md" />
          <div className="h-9 w-9 skeleton-shimmer rounded-lg" />
          <div className="space-y-1.5">
            <div className="h-5 w-40 skeleton-shimmer rounded" />
            <div className="h-3 w-20 skeleton-shimmer rounded" />
          </div>
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Metadata card skeleton */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-3">
            <div className="h-4 w-3/4 skeleton-shimmer rounded" />
            <div className="h-4 w-1/2 skeleton-shimmer rounded" />
            <div className="h-3 w-48 skeleton-shimmer rounded" />
          </div>
          {/* Instructions card skeleton */}
          <div className="rounded-lg border border-border bg-card p-6 space-y-3">
            <div className="h-4 w-full skeleton-shimmer rounded" />
            <div className="h-4 w-full skeleton-shimmer rounded" />
            <div className="h-4 w-5/6 skeleton-shimmer rounded" />
            <div className="h-4 w-full skeleton-shimmer rounded" />
            <div className="h-4 w-2/3 skeleton-shimmer rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillDetailPage({ name }: SkillDetailPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { getSkill, refetch } = useSkillsCache();
  const skill = getSkill(name);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    setError(null);
    try {
      await uninstallSkill(name);
      refetch();
      router.push("/skills");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to uninstall skill",
      );
      setShowDeleteDialog(false);
    }
  }, [name, refetch, router]);

  if (!skill) {
    return <DetailSkeleton />;
  }

  const config = sourceStyle[skill.source_type] ?? sourceStyle.bundled;
  const SourceIcon = config.icon;
  const labelKey =
    SOURCE_LABEL_KEY[skill.source_type] ?? SOURCE_LABEL_KEY.bundled;
  const showDelete = skill.source_type === "user";

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <motion.div
        className="shrink-0 border-b border-border px-6 py-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/skills")}
            aria-label={t("skills.backToSkills")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {normalizeSkillName(skill.name)}
            </h1>
          </div>

          <Badge
            variant="secondary"
            className={cn(
              "shrink-0 text-micro font-medium px-1.5 py-0",
              config.className,
            )}
          >
            <SourceIcon className="mr-1 h-2.5 w-2.5" />
            {t(labelKey)}
          </Badge>

          {showDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteDialog(true)}
              aria-label={`${t("skills.uninstall")} ${normalizeSkillName(skill.name)}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </motion.div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <motion.div
          className="mx-auto max-w-4xl space-y-6"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: "easeOut", delay: 0.05 }}
        >
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-2.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              <p className="flex-1 text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Metadata card */}
          {skill.description && (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {skill.description}
              </p>
            </div>
          )}

          {/* Instructions card */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-foreground">
              {t("skills.instructions")}
            </h2>
            {skill.instructions ? (
              <div className="rounded-lg border border-border bg-card p-6 lg:p-8">
                <MarkdownRenderer className="markdown-prose" content={skill.instructions} />
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-10">
                <p className="text-sm text-muted-foreground-dim">
                  {t("skills.noInstructions")}
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("skills.uninstallTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("skills.uninstallDesc", {
                name: normalizeSkillName(skill.name),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("skills.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
            >
              {t("skills.uninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
