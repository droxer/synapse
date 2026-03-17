"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Presentation,
  Globe,
  AppWindow,
  Palette,
  MoreHorizontal,
  Plus,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { SendButton } from "@/shared/components/SendButton";
import { FileAttachmentChip } from "@/shared/components/FileAttachmentChip";
import type { AttachedFile } from "@/shared/types";

interface WelcomeScreenProps {
  onSubmitTask: (task: string, files?: File[]) => void;
}

const QUICK_ACTIONS = [
  { icon: Presentation, label: "Create slides", prompt: "Create a presentation about " },
  { icon: Globe, label: "Build website", prompt: "Build a website that " },
  { icon: AppWindow, label: "Develop apps", prompt: "Develop an app that " },
  { icon: Palette, label: "Design", prompt: "Design a " },
  { icon: MoreHorizontal, label: "More", prompt: "" },
] as const;

const HEADING_WORDS = ["What", "can", "I", "build", "for", "you?"];

const cardContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.35,
    },
  },
};

const cardItem = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: "easeOut" as const },
  },
};

export function WelcomeScreen({ onSubmitTask }: WelcomeScreenProps) {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = "";
  }, [addFiles]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    const files = attachedFiles.length > 0 ? attachedFiles.map((f) => f.file) : undefined;
    onSubmitTask(trimmed || "See attached files", files);
    setInput("");
    setAttachedFiles([]);
  };

  const handleQuickAction = (prompt: string) => {
    if (prompt) {
      setInput(prompt);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-6">
      {/* Animated gradient mesh background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 60% 50% at 30% 40%, var(--color-ai-surface) 0%, transparent 70%)",
            "radial-gradient(ellipse 50% 60% at 70% 55%, color-mix(in srgb, var(--color-accent-purple) 4%, transparent) 0%, transparent 70%)",
          ].join(", "),
          backgroundSize: "200% 200%",
          animation: "meshDrift 20s ease-in-out infinite",
        }}
      />

      <motion.div
        className="relative z-10 flex w-full max-w-[680px] flex-col items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Staggered word reveal heading */}
        <h1 className="mb-10 text-center font-serif text-[2.75rem] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[3.25rem]">
          {HEADING_WORDS.map((word, i) => (
            <motion.span
              key={i}
              className="inline-block mr-[0.3em]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                delay: i * 0.08,
                ease: "easeOut",
              }}
            >
              {word}
            </motion.span>
          ))}
        </h1>

        {/* Input card */}
        <form onSubmit={handleSubmit} className="mb-6 w-full">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          <div
            className="rounded-xl border backdrop-blur-sm bg-card/80 transition-all duration-200"
            style={{
              borderColor: isFocused
                ? "var(--color-border-active)"
                : "var(--color-border)",
              boxShadow: isFocused
                ? "var(--shadow-card-hover), 0 0 20px var(--color-input-glow)"
                : "var(--shadow-card)",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="What can I help you build?"
              rows={3}
              className="w-full resize-none rounded-t-xl bg-transparent px-4 pt-4 pb-2 text-sm leading-relaxed text-foreground placeholder:text-placeholder outline-none"
              autoFocus
            />

            {/* File preview chips */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pb-2">
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

            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More options"
                  className="text-muted-foreground/50 hover:bg-secondary hover:text-muted-foreground"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Attach file"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-muted-foreground/50 hover:bg-secondary hover:text-muted-foreground"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="AI suggestions"
                  className="text-muted-foreground/50 hover:bg-secondary hover:text-muted-foreground"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </div>

              <SendButton
                hasContent={!!input.trim() || attachedFiles.length > 0}
              />
            </div>
          </div>
        </form>

        {/* Capability cards (replacing pills) */}
        <motion.div
          className="flex flex-wrap justify-center gap-2.5"
          variants={cardContainer}
          initial="hidden"
          animate="show"
        >
          {QUICK_ACTIONS.map((action) => (
            <motion.button
              key={action.label}
              variants={cardItem}
              onClick={() => handleQuickAction(action.prompt)}
              whileHover={{ y: -2 }}
              className="group relative flex items-center gap-2 rounded-xl border border-border bg-card/80 px-4 py-2.5 text-sm text-muted-foreground backdrop-blur-sm transition-all hover:border-border-active hover:text-foreground"
            >
              <action.icon className="h-4 w-4 transition-colors group-hover:text-ai-glow" />
              {action.label}
              {/* Glowing underline reveal on hover */}
              <span className="absolute bottom-0 left-3 right-3 h-px bg-ai-glow/0 transition-all duration-300 group-hover:bg-ai-glow/40" />
            </motion.button>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
