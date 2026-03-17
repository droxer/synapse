"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Square, Paperclip } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { SendButton } from "@/shared/components/SendButton";
import { FileAttachmentChip } from "@/shared/components/FileAttachmentChip";
import { cn } from "@/shared/lib/utils";
import type { AttachedFile } from "@/shared/types";

interface ChatInputProps {
  readonly onSendMessage: (message: string, files?: File[]) => void;
  readonly disabled?: boolean;
  readonly onCancel?: () => void;
  readonly isAgentRunning?: boolean;
}

export function ChatInput({ onSendMessage, disabled = false, onCancel, isAgentRunning = false }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resetHeight();
  }, [input, resetHeight]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: AttachedFile[] = Array.from(fileList).map((file) => ({
      file,
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
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

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    const files = attachedFiles.length > 0 ? attachedFiles.map((f) => f.file) : undefined;
    onSendMessage(trimmed || "See attached files", files);
    setInput("");
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
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
          onChange={handleFileInputChange}
        />

        <div
          className={cn(
            "relative rounded-xl backdrop-blur-sm bg-card/80 transition-shadow duration-200",
            isFocused
              ? "shadow-[0_0_0_1px_var(--color-border-active),0_4px_12px_rgba(0,0,0,0.3),0_0_20px_var(--color-input-glow)]"
              : "shadow-[0_0_0_1px_var(--color-border),0_1px_3px_rgba(0,0,0,0.2)]",
            isDragOver && "ring-2 ring-[var(--color-border-active)] bg-secondary/40",
          )}
        >
          {/* File preview chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachedFiles.map((af) => (
                <FileAttachmentChip
                  key={af.id}
                  name={af.file.name}
                  size={af.file.size}
                  previewUrl={af.previewUrl}
                  onRemove={() => removeFile(af.id)}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onPaste={handlePaste}
            placeholder={disabled ? "Agent is working..." : "What can I help you build?"}
            disabled={disabled}
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent px-4 pt-3.5 pb-10 text-sm leading-relaxed text-foreground placeholder:text-placeholder outline-none",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          />

          {/* Bottom bar: paperclip + hint + action button */}
          <div className="absolute right-3 bottom-2.5 left-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Attach file"
                onClick={() => fileInputRef.current?.click()}
                className="text-muted-foreground/50 hover:bg-secondary hover:text-muted-foreground"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <span
                className={cn(
                  "text-xs text-placeholder select-none transition-opacity duration-150",
                  hasContent && !isAgentRunning ? "opacity-100" : "opacity-0",
                )}
              >
                <kbd className="font-mono text-[10px]">Enter</kbd> to send
                <span className="mx-1 text-border-strong">&middot;</span>
                <kbd className="font-mono text-[10px]">Shift + Enter</kbd> for new line
              </span>
            </div>

            <div className="relative flex h-8 w-8 items-center justify-center">
              <AnimatePresence mode="wait">
                {isAgentRunning ? (
                  <motion.button
                    key="cancel"
                    type="button"
                    onClick={onCancel}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      "group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      "bg-foreground/[0.06] text-muted-foreground",
                      "transition-all duration-200 ease-out",
                      "hover:bg-destructive/10 hover:text-destructive",
                      "active:scale-90 active:bg-destructive/15",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none",
                    )}
                  >
                    {/* Conic-gradient spinning border */}
                    <span
                      className="absolute inset-0 rounded-lg opacity-60"
                      style={{
                        background: "conic-gradient(from 0deg, var(--color-ai-glow), transparent 60%, var(--color-ai-glow))",
                        mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                        maskComposite: "exclude",
                        WebkitMaskComposite: "xor",
                        padding: "1px",
                        animation: "conicSpin 3s linear infinite",
                      }}
                    />
                    <Square
                      className="relative h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110"
                      fill="currentColor"
                      strokeWidth={0}
                    />
                  </motion.button>
                ) : (
                  <SendButton
                    key="send"
                    disabled={disabled}
                    hasContent={hasContent}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
