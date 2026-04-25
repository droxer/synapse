"use client";

import { useState, useCallback, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Lightbulb, Plus, Package, Globe, X, Upload, FileText, FolderOpen, Search } from "lucide-react";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { SearchInput } from "@/shared/components/SearchInput";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { SkillCard } from "./SkillCard";
import { SkillSection } from "./SkillSection";
import { cn } from "@/shared/lib/utils";
import { listVariants } from "@/shared/lib/animations";
import { useSkillsCache } from "../hooks/use-skills-cache";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import {
  installSkill,
  uninstallSkill,
  uploadSkill,
  toggleSkill,
} from "../api/skills-api";
import { useSkillsForm } from "../hooks/use-skills-form";
import { useTranslation } from "@/i18n";

/* ── skeleton (matches grid card layout) ── */
function SkillSkeleton() {
  return (
    <div className="surface-panel flex flex-col p-4">
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 shrink-0 rounded-lg skeleton-shimmer" />
        <div className="h-4 w-14 skeleton-shimmer" />
      </div>
      <div className="mt-3 h-4 w-28 skeleton-shimmer" />
      <div className="mt-2 min-h-[2.5rem] space-y-1.5">
        <div className="h-3 w-full skeleton-shimmer" />
        <div className="h-3 w-3/4 skeleton-shimmer" />
      </div>
      <div className="mt-auto pt-3">
        <div className="h-2.5 w-24 skeleton-shimmer" />
      </div>
    </div>
  );
}

/** Recursively read all files from a dropped directory, preserving relative paths. */
async function readDirectoryEntries(
  dirEntry: FileSystemDirectoryEntry,
  rootName: string,
): Promise<File[]> {
  const files: File[] = [];

  async function readDir(entry: FileSystemDirectoryEntry, path: string) {
    const reader = entry.createReader();
    // readEntries may not return all entries in one call
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      for (const child of batch) {
        if (child.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            (child as FileSystemFileEntry).file(resolve, reject),
          );
          // Reconstruct with relative path so the backend can rebuild the folder structure
          const relativePath = `${path}/${file.name}`;
          const withPath = new File([file], relativePath, { type: file.type });
          files.push(withPath);
        } else if (child.isDirectory) {
          await readDir(child as FileSystemDirectoryEntry, `${path}/${child.name}`);
        }
      }
    } while (batch.length > 0);
  }

  await readDir(dirEntry, rootName);
  return files;
}

const ACCEPTED_FILE_TYPES = [".zip", ".md"];

export function SkillsPage() {
  const { t } = useTranslation();
  const { getAllSkills, refetch, isLoading } = useSkillsCache();
  const skills = getAllSkills();

  const [pageError, setPageError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const {
    showForm,
    setShowForm,
    installSource,
    setInstallSource,
    formUrl,
    setFormUrl,
    submitting,
    setSubmitting,
    selectedFiles,
    setSelectedFiles,
    isFolderUpload,
    setIsFolderUpload,
    folderName,
    setFolderName,
    isDragging,
    setIsDragging,
    resetForm,
  } = useSkillsForm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [skillToDelete, setSkillToDelete] = useState<string | null>(null);

  const handleInstall = async () => {
    if (installSource === "upload") {
      if (!selectedFiles || selectedFiles.length === 0) return;
      setSubmitting(true);
      setDialogError(null);
      try {
        await uploadSkill(selectedFiles);
        refetch();
        resetForm();
      } catch (err) {
        setDialogError(err instanceof Error ? err.message : "Failed to upload skill");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!formUrl.trim()) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      await installSkill({ url: formUrl.trim() });
      refetch();
      resetForm();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Failed to install skill");
    } finally {
      setSubmitting(false);
    }
  };

  const isAcceptedFile = useCallback((file: File) => {
    return ACCEPTED_FILE_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext));
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, [setIsDragging]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, [setIsDragging]);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const entry = items[0].webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      const files = await readDirectoryEntries(entry as FileSystemDirectoryEntry, entry.name);
      const accepted = files.filter(isAcceptedFile);
      if (accepted.length > 0) {
        setSelectedFiles(accepted);
        setIsFolderUpload(true);
        setFolderName(entry.name);
      } else if (files.length > 0) {
        setDialogError("Only .zip and .md files are supported");
      }
    } else if (e.dataTransfer.files.length > 0) {
      const dropped = Array.from(e.dataTransfer.files);
      const accepted = dropped.filter(isAcceptedFile);
      if (accepted.length > 0) {
        setSelectedFiles(accepted);
        setIsFolderUpload(false);
        setFolderName("");
      } else {
        setDialogError("Only .zip and .md files are supported");
      }
    }
  }, [isAcceptedFile, setFolderName, setIsDragging, setIsFolderUpload, setSelectedFiles]);

  const handleDelete = useCallback(async () => {
    if (!skillToDelete) return;
    setPageError(null);
    try {
      await uninstallSkill(skillToDelete);
      refetch();
      setSkillToDelete(null);
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Failed to uninstall skill",
      );
    }
  }, [refetch, skillToDelete]);

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    setPageError(null);
    try {
      await toggleSkill(name, enabled);
      refetch();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to toggle skill");
    }
  }, [refetch]);

  const bundledSkills = skills.filter((s) => s.source_type === "bundled");
  const installedSkills = skills.filter((s) => s.source_type !== "bundled");

  const filtered = filter
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.description?.toLowerCase().includes(filter.toLowerCase()),
      )
    : null;

  const displaySkills = filtered ?? skills;
  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <motion.div
        className="shrink-0 px-4 py-5 sm:px-6"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Lightbulb aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="label-mono text-muted-foreground-dim">
                  {t("skills.agentSkills")}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.9rem]">
                  {t("skills.title")}
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {t("skills.subtitle")}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]">
              <div className="rounded-lg bg-muted/50 px-4 py-3">
                <p className="label-mono text-muted-foreground-dim">
                  {t("skills.sectionBuiltIn")}
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                  {bundledSkills.length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("skills.sectionBuiltInDesc")}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 px-4 py-3">
                <p className="label-mono text-muted-foreground-dim">
                  {t("skills.sectionInstalled")}
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                  {installedSkills.length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("skills.sectionInstalledDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {/* Error banner */}
          {pageError && (
            <ErrorBanner message={pageError} onDismiss={() => setPageError(null)} />
          )}

          {/* Section header with search + install */}
          <div className="flex flex-col gap-3 rounded-lg bg-muted/30 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="label-mono text-muted-foreground-dim">
                {t("skills.agentSkills")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("skills.subtitle")}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {skills.length > 3 && (
                <SearchInput
                  value={filter}
                  onChange={setFilter}
                  placeholder={t("skills.filterPlaceholder")}
                  clearLabel={t("skills.clearFilter")}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowForm(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("skills.installSkill")}
              </Button>
            </div>
          </div>

          {/* ── Skill grid ── */}
          {isLoading && skills.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SkillSkeleton />
              <SkillSkeleton />
              <SkillSkeleton />
              <SkillSkeleton />
              <SkillSkeleton />
              <SkillSkeleton />
            </div>
          ) : displaySkills.length === 0 && filter ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <EmptyState
                icon={Search}
                title={t("skills.noSkillsMatchingTitle", { defaultValue: "No matching skills" })}
                description={t("skills.noSkillsMatching", { filter })}
                dashed
                className="w-full max-w-xl mx-auto"
              />
            </motion.div>
          ) : skills.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12, delay: 0.05 }}
            >
              <EmptyState
                icon={Lightbulb}
                title={t("skills.noSkillsAvailable")}
                description={t("skills.noSkillsHint")}
                dashed
                className="w-full max-w-xl mx-auto"
              />
            </motion.div>
          ) : filter ? (
            /* Flat grid when search is active */
            <motion.div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              variants={listVariants.container}
              initial="hidden"
              animate="show"
            >
              {displaySkills.map((skill) => (
                <motion.div key={skill.name} variants={listVariants.item} className="h-full">
                  <SkillCard
                    skill={skill}
                    onDelete={setSkillToDelete}
                    onToggle={skill.source_type === "bundled" ? undefined : handleToggle}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            /* Two-section layout when not searching */
            <div className="space-y-8">
              {bundledSkills.length > 0 && (
                <SkillSection
                  icon={Package}
                  title={t("skills.sectionBuiltIn")}
                  description={t("skills.sectionBuiltInDesc")}
                  count={bundledSkills.length}
                >
                  <motion.div
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    variants={listVariants.container}
                    initial="hidden"
                    animate="show"
                  >
                    {bundledSkills.map((skill) => (
                      <motion.div key={skill.name} variants={listVariants.item} className="h-full">
                        <SkillCard skill={skill} />
                      </motion.div>
                    ))}
                  </motion.div>
                </SkillSection>
              )}

              <SkillSection
                icon={Globe}
                title={t("skills.sectionInstalled")}
                description={t("skills.sectionInstalledDesc")}
                count={installedSkills.length}
              >
                {installedSkills.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.12, delay: 0.05 }}
                  >
                    <EmptyState
                      icon={Globe}
                      title={t("skills.noInstalledSkills")}
                      description={t("skills.noInstalledSkillsHint")}
                      dashed
                      className="w-full max-w-xl mx-auto"
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    variants={listVariants.container}
                    initial="hidden"
                    animate="show"
                  >
                    {installedSkills.map((skill) => (
                      <motion.div key={skill.name} variants={listVariants.item} className="h-full">
                        <SkillCard
                          skill={skill}
                          onDelete={setSkillToDelete}
                          onToggle={handleToggle}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </SkillSection>
            </div>
          )}
        </div>
      </div>

      {/* ── Install skill dialog ── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { resetForm(); setDialogError(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("skills.installFormTitle")}</DialogTitle>
            <DialogDescription>{t("skills.subtitle")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Error inside dialog */}
            {dialogError && (
              <ErrorBanner message={dialogError} onDismiss={() => setDialogError(null)} variant="compact" />
            )}

            {/* Source toggle */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.source")}</Label>
              <div className="flex gap-1 rounded-md bg-secondary p-1">
                {(["upload", "git"] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => { if (src !== "git") setInstallSource(src); }}
                    disabled={src === "git"}
                    className={cn(
                      "flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      src === "git"
                        ? "cursor-not-allowed text-muted-foreground-dim opacity-60"
                        : installSource === src
                          ? "border border-border bg-background text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {src === "git" ? t("skills.gitRepoComingSoon") : t("skills.upload")}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content — fixed height so dialog doesn't resize on tab switch */}
            <div className="min-h-[10rem]">
              {/* URL field (git mode) */}
              {installSource === "git" && (
                <div className="space-y-1.5">
                  <Input
                    id="skill-url"
                    placeholder={t("skills.repoPlaceholder")}
                    value={formUrl}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setFormUrl(e.target.value)}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter" && formUrl.trim() && !submitting) {
                        handleInstall();
                      }
                    }}
                    className="font-mono"
                    autoFocus
                  />
                </div>
              )}

              {/* Upload drop zone */}
              {installSource === "upload" && (
                <div className="space-y-1.5">
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 transition-colors duration-150",
                      isDragging
                        ? "border-border-active bg-secondary"
                        : "border-border hover:border-border-strong hover:bg-secondary",
                    )}
                  >
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {isDragging ? t("skills.dropZoneActive") : t("skills.dropZone")}
                    </p>
                    <p className="text-xs text-muted-foreground-dim">
                      {t("skills.dropZoneHint")}
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    >
                      {t("chat.attachFile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="text-xs text-focus underline-offset-2 hover:underline"
                    >
                      {t("skills.chooseFolder")}
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".zip,.md"
                    className="hidden"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setSelectedFiles(Array.from(e.target.files));
                        setIsFolderUpload(false);
                        setFolderName("");
                      }
                    }}
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    webkitdirectory=""
                    className="hidden"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      if (e.target.files && e.target.files.length > 0) {
                        const files: File[] = Array.from(e.target.files);
                        setSelectedFiles(files);
                        setIsFolderUpload(true);
                        // Extract folder name from the first file's webkitRelativePath
                        const firstPath = files[0].webkitRelativePath;
                        setFolderName(firstPath ? firstPath.split("/")[0] : "folder");
                      }
                    }}
                  />
                  {selectedFiles && selectedFiles.length > 0 && (
                    <div className="flex items-center gap-2 rounded-md bg-secondary px-3 py-2">
                      {isFolderUpload
                        ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="flex-1 text-xs text-foreground">
                        {isFolderUpload
                          ? t("skills.selectedFolder", { name: folderName })
                          : t("skills.selectedFiles", { count: selectedFiles.length })}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFiles(null);
                          setIsFolderUpload(false);
                          setFolderName("");
                        }}
                        className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={resetForm}>
                {t("skills.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleInstall}
                disabled={
                  submitting ||
                  (installSource === "upload"
                    ? !selectedFiles || selectedFiles.length === 0
                    : !formUrl.trim())
                }
              >
                {submitting && (
                  <span className="mr-1.5 inline-block h-3.5 w-3.5 skeleton-shimmer rounded-sm" />
                )}
                {t("skills.install")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={skillToDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSkillToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("skills.uninstallTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("skills.uninstallDesc", { name: skillToDelete ? normalizeSkillName(skillToDelete) : "" })}
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
