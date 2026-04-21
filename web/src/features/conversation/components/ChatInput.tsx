"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Square, Plus, ArrowUp, GitFork } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { FileAttachmentChip } from "@/shared/components/FileAttachmentChip";
import { SkillSelector } from "@/features/skills";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import type { AttachedFile } from "@/shared/types";

interface ChatInputProps {
  readonly onSendMessage: (message: string, files?: File[], skills?: string[], usePlanner?: boolean) => void;
  readonly disabled?: boolean;
  readonly onCancel?: () => void;
  readonly isAgentRunning?: boolean;
  readonly variant?: "default" | "welcome";
  readonly autoFocus?: boolean;
}

export function ChatInput({ onSendMessage, disabled = false, onCancel, isAgentRunning = false, variant = "default", autoFocus = false }: ChatInputProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [usePlanner, setUsePlanner] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachedFilesRef = useRef<AttachedFile[]>([]);

  const revokePreviewUrls = useCallback((files: AttachedFile[]) => {
    files.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, []);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resetHeight();
  }, [input, resetHeight]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: AttachedFile[] = Array.from(fileList).map((file) => ({
      file,
      id: crypto.randomUUID(),
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      revokePreviewUrls(attachedFilesRef.current);
    };
  }, [revokePreviewUrls]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    const files = attachedFiles.length > 0 ? attachedFiles.map((f) => f.file) : undefined;
    const skills = selectedSkill ? [selectedSkill] : undefined;
    onSendMessage(trimmed || t("chat.defaultFileMessage"), files, skills, usePlanner || undefined);
    revokePreviewUrls(attachedFiles);
    setInput("");
    setAttachedFiles([]);
    setSelectedSkill(null);
    setUsePlanner(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      addFiles(imageFiles);
    }
  }, [addFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Reset so the same file can be selected again
    e.target.value = "";
  }, [addFiles]);

  const hasContent = input.trim().length > 0 || attachedFiles.length > 0;
  const hasAttachments = attachedFiles.length > 0;
  const isWelcome = variant === "welcome";

  return (
    <div className={cn(!isWelcome && "shrink-0 px-4 pb-safe-4 pt-2")}>
      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label={t("chat.attachFile")}
          onChange={handleFileInputChange}
        />

        <div
          className={cn(
            "surface-input-composer relative focus-within:surface-input-composer-focus",
            isDragOver && "border-dashed !border-border-active bg-secondary",
          )}
        >
          {/* File & skill attachment shelf */}
          <AnimatePresence>
            {hasAttachments && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.12, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-2">
                  <AnimatePresence>
                    {attachedFiles.map((af) => (
                      <motion.div
                        key={af.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
                      >
                        <FileAttachmentChip
                          name={af.file.name}
                          size={af.file.size}
                          previewUrl={af.previewUrl}
                          onRemove={() => removeFile(af.id)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={disabled ? t("chat.placeholderWorking") : t("chat.placeholder")}
            disabled={disabled}
            rows={isWelcome ? 3 : 1}
            autoFocus={autoFocus || isWelcome}
            aria-label={t("chat.inputLabel")}
            className={cn(
              "w-full resize-none bg-transparent px-4 pt-3 pb-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          />

          {/* Toolbar divider + action bar */}
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            {/* Left: tools + hints */}
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("chat.attachFile")}
                title={t("chat.attachFile")}
                onClick={() => fileInputRef.current?.click()}
                className="h-7 gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>

              <SkillSelector
                selectedSkill={selectedSkill}
                onSelect={setSelectedSkill}
                variant={isWelcome ? "welcome" : "default"}
              />

              {isWelcome && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("chat.planner")}
                  aria-pressed={usePlanner}
                  onClick={() => setUsePlanner((v) => !v)}
                  className={cn(
                    "h-7 gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors duration-150",
                    usePlanner
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={usePlanner ? t("chat.plannerActive") : t("chat.plannerHint")}
                >
                  <GitFork className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("chat.planLabel")}</span>
                </Button>
              )}

            </div>

            {/* Right: send / cancel */}
            <AnimatePresence mode="wait">
              {isAgentRunning ? (
                  <motion.div
                    key="cancel"
                    initial={{ opacity: shouldReduceMotion ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: shouldReduceMotion ? 1 : 0 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
                  >
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    onClick={onCancel}
                    aria-label={t("chat.cancelExecution")}
                    title={t("chat.cancelExecution")}
                    className="group h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:bg-destructive/15"
                  >
                    <Square
                      className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110"
                      fill="currentColor"
                      strokeWidth={0}
                    />
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="send"
                  initial={{ opacity: shouldReduceMotion ? (hasContent ? 1 : 0.4) : 0 }}
                  animate={{ opacity: hasContent ? 1 : 0.4 }}
                  exit={{ opacity: shouldReduceMotion ? (hasContent ? 1 : 0.4) : 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
                >
                  <Button
                    type="submit"
                    size="icon"
                    disabled={disabled || !hasContent}
                    aria-label={hasContent ? t("chat.sendMessage") : t("chat.typeToSend")}
                    title={hasContent ? t("chat.sendMessage") : t("chat.typeToSend")}
                    className={cn(
                      "h-8 w-8 rounded-lg transition-colors duration-200",
                      hasContent && "bg-primary text-primary-foreground hover:bg-primary/90",
                      !hasContent && "bg-transparent text-muted-foreground",
                    )}
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </form>
    </div>
  );
}
