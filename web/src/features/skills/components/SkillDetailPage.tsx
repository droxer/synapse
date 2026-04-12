"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Lightbulb,
  Trash2,
  FileCode,
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
import { cn } from "@/shared/lib/utils";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { useSkillsCache } from "../hooks/use-skills-cache";
import { useSkillFiles } from "../hooks/use-skill-files";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import { SOURCE_STYLE, SOURCE_LABEL_KEY } from "../lib/skill-source-styles";
import { uninstallSkill } from "../api/skills-api";
import { useTranslation } from "@/i18n";
import { FileTree } from "./FileTree";
import { FileContentViewer } from "./FileContentViewer";


interface SkillDetailPageProps {
  readonly name: string;
}

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header skeleton */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 skeleton-shimmer rounded-md" />
          <div className="h-9 w-9 skeleton-shimmer rounded-lg" />
          <div className="space-y-1.5">
            <div className="h-5 w-40 skeleton-shimmer rounded" />
            <div className="h-3 w-20 skeleton-shimmer rounded" />
          </div>
        </div>
      </div>
      {/* Body skeleton: sidebar + content */}
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        <div className="w-full md:w-[250px] md:shrink-0 max-h-[200px] md:max-h-none overflow-y-auto border-r border-border p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 skeleton-shimmer rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
          ))}
        </div>
        <div className="flex-1 p-6 space-y-3">
          <div className="h-4 w-3/4 skeleton-shimmer rounded" />
          <div className="h-4 w-full skeleton-shimmer rounded" />
          <div className="h-4 w-5/6 skeleton-shimmer rounded" />
          <div className="h-4 w-2/3 skeleton-shimmer rounded" />
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

  const {
    fileTree,
    selectedPath,
    fileContent,
    isLoadingTree,
    isLoadingContent,
    selectFile,
  } = useSkillFiles(name);

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

  const config = SOURCE_STYLE[skill.source_type] ?? SOURCE_STYLE.bundled;
  const SourceIcon = config.icon;
  const labelKey =
    SOURCE_LABEL_KEY[skill.source_type] ?? SOURCE_LABEL_KEY.bundled;
  const showDelete = skill.source_type === "user";

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/skills" aria-label={t("skills.backToSkills")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>

          <div className="chip-muted flex h-9 w-9 shrink-0 items-center justify-center">
            <Lightbulb aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {normalizeSkillName(skill.name)}
            </h1>
            {skill.description && (
              <p className="truncate text-sm text-muted-foreground">
                {skill.description}
              </p>
            )}
          </div>

          <Badge
            variant="secondary"
            className={cn(
              "shrink-0 text-micro font-medium px-1.5 py-0",
              config.className,
            )}
          >
            <SourceIcon aria-hidden="true" className="mr-1 h-2.5 w-2.5" />
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

        {/* Error banner */}
        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} onDismiss={() => setError(null)} variant="compact" />
          </div>
        )}
      </div>

      {/* ── Body: File Tree + Content Viewer ── */}
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        {/* Sidebar: File Tree */}
        <div className="w-full md:w-[250px] md:shrink-0 max-h-[280px] md:max-h-none overflow-y-auto border-r border-border">
          {isLoadingTree ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-5 skeleton-shimmer rounded"
                  style={{ width: `${60 + (i * 7) % 40}%` }}
                />
              ))}
            </div>
          ) : fileTree.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-xs text-muted-foreground-dim">
                {t("skills.noFileSelected")}
              </p>
            </div>
          ) : (
            <FileTree
              nodes={fileTree}
              selectedPath={selectedPath}
              onSelectFile={selectFile}
            />
          )}
        </div>

        {/* Content Viewer */}
        <div className="flex-1 overflow-hidden">
          {selectedPath && fileContent !== null ? (
            <FileContentViewer
              path={selectedPath}
              content={fileContent}
              isLoading={isLoadingContent}
            />
          ) : isLoadingContent ? (
            <div className="flex flex-col gap-3 p-6">
              <div className="h-4 w-3/4 skeleton-shimmer rounded" />
              <div className="h-4 w-full skeleton-shimmer rounded" />
              <div className="h-4 w-5/6 skeleton-shimmer rounded" />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <FileCode aria-hidden="true" className="h-10 w-10 text-muted-foreground-dim" />
              <p className="text-sm text-muted-foreground-dim">
                {t("skills.noFileSelected")}
              </p>
            </div>
          )}
        </div>
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
