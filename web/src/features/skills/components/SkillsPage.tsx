"use client";

import { useState, useCallback, useRef, type ChangeEvent, type DragEvent } from "react";
import { motion } from "framer-motion";
import { Lightbulb, Loader2, Plus, Package, Globe, X, Upload, FileText, FolderOpen, Search } from "lucide-react";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { ProductPageHeader, ProductSectionHeader, ProductStatCard } from "@/shared/components/ProductPage";
import { SearchInput } from "@/shared/components/SearchInput";
import { ToolingCardSkeletonGrid } from "@/shared/components/ToolingCard";
import { Button } from "@/shared/components/ui/button";
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
import { AddEntityDialog } from "@/shared/components/AddEntityDialog";
import { SkillCard } from "./SkillCard";
import { SkillSection } from "./SkillSection";
import { cn } from "@/shared/lib/utils";
import { listVariants } from "@/shared/lib/animations";
import {
  TOOLING_DROPZONE_CLASSES,
} from "@/shared/lib/tooling-ui-styles";
import { useSkillsCache } from "../hooks/use-skills-cache";
import { normalizeSkillName } from "../lib/normalize-skill-name";
import {
  uninstallSkill,
  uploadSkill,
  toggleSkill,
} from "../api/skills-api";
import { useSkillsForm } from "../hooks/use-skills-form";
import { useTranslation } from "@/i18n";

/** Recursively read all files from a dropped directory, preserving relative paths. */
async function readDirectoryEntries(
  dirEntry: FileSystemDirectoryEntry,
  rootName: string,
): Promise<File[]> {
  const files: File[] = [];

  async function readDir(entry: FileSystemDirectoryEntry, path: string) {
    const reader = entry.createReader();
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

  const [skillToDelete, setSkillToDelete] = useState<string | null>(null);

  const handleInstall = async () => {
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
    <div className="flex h-full flex-col bg-canvas">
      <ProductPageHeader
        icon={<Lightbulb aria-hidden="true" className="h-5 w-5 text-steel" />}
        eyebrow={t("skills.agentSkills")}
        title={t("skills.title")}
        description={t("skills.subtitle")}
        statsClassName="grid-cols-1 sm:grid-cols-2 lg:min-w-[22rem]"
        stats={
          <>
            <ProductStatCard
              label={t("skills.sectionBuiltIn")}
              value={bundledSkills.length}
              description={t("skills.sectionBuiltInDesc")}
            />
            <ProductStatCard
              label={t("skills.sectionInstalled")}
              value={installedSkills.length}
              description={t("skills.sectionInstalledDesc")}
            />
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {pageError && (
            <ErrorBanner message={pageError} onDismiss={() => setPageError(null)} />
          )}

          <ProductSectionHeader
            actions={
              <>
                {skills.length > 3 && (
                  <SearchInput
                    value={filter}
                    onChange={setFilter}
                    placeholder={t("skills.filterPlaceholder")}
                    clearLabel={t("skills.clearFilter")}
                  />
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowForm(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t("skills.installSkill")}
                </Button>
              </>
            }
          />

          {isLoading && skills.length === 0 ? (
            <ToolingCardSkeletonGrid />
          ) : displaySkills.length === 0 && filter ? (
            <EmptyState
              icon={Search}
              title={t("skills.noSkillsMatchingTitle", { defaultValue: "No matching skills" })}
              description={t("skills.noSkillsMatching", { filter })}
              dashed
              className="w-full max-w-xl mx-auto"
            />
          ) : skills.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title={t("skills.noSkillsAvailable")}
              description={t("skills.noSkillsHint")}
              dashed
              className="w-full max-w-xl mx-auto"
            />
          ) : filter ? (
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
                  <EmptyState
                    icon={Globe}
                    title={t("skills.noInstalledSkills")}
                    description={t("skills.noInstalledSkillsHint")}
                    dashed
                    className="w-full max-w-xl mx-auto"
                  />
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

      <AddEntityDialog
        open={showForm}
        onOpenChange={(open) => { if (!open) { resetForm(); setDialogError(null); } }}
        icon={<Lightbulb className="h-4 w-4 text-steel" />}
        title={t("skills.installFormTitle")}
        description={t("skills.installFormDescription")}
      >
        <div className="space-y-4">
          {dialogError && (
            <ErrorBanner message={dialogError} onDismiss={() => setDialogError(null)} variant="compact" />
          )}

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              TOOLING_DROPZONE_CLASSES,
              "cursor-default",
              isDragging
                ? "border-charcoal bg-surface-soft"
                : "border-hairline-soft hover:border-hairline",
            )}
          >
            <Upload className="h-6 w-6 text-steel" />
            <p className="text-sm text-steel">
              {isDragging ? t("skills.dropZoneActive") : t("skills.dropZone")}
            </p>
            <p className="text-xs text-stone">{t("skills.dropZoneHint")}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText className="h-3.5 w-3.5" />
                {t("skills.chooseFile")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("skills.chooseFolder")}
              </Button>
            </div>
            <p className="mt-3 text-micro text-stone">{t("skills.gitComingSoon")}</p>
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
                const firstPath = files[0].webkitRelativePath;
                setFolderName(firstPath ? firstPath.split("/")[0] : "folder");
              }
            }}
          />

          {selectedFiles && selectedFiles.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-hairline-soft bg-surface-soft px-3 py-2">
              {isFolderUpload
                ? <FolderOpen className="h-3.5 w-3.5 text-steel" />
                : <FileText className="h-3.5 w-3.5 text-steel" />}
              <span className="flex-1 truncate text-xs text-ink-deep">
                {isFolderUpload
                  ? t("skills.selectedFolder", { name: folderName })
                  : t("skills.selectedFiles", { count: selectedFiles.length })}
              </span>
              <button
                type="button"
                aria-label={t("skills.clearSelectedUpload")}
                onClick={() => {
                  setSelectedFiles(null);
                  setIsFolderUpload(false);
                  setFolderName("");
                }}
                className="rounded-sm p-0.5 text-steel hover:text-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" size="sm" onClick={resetForm}>
              {t("skills.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={submitting || !selectedFiles || selectedFiles.length === 0}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("skills.install")}
            </Button>
          </div>
        </div>
      </AddEntityDialog>

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
              className="bg-critical text-white hover:bg-critical/90"
            >
              {t("skills.uninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
