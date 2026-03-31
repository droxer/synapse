"use client";

import { Paperclip, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { formatFileSize } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface FileAttachmentChipProps {
  readonly name: string;
  readonly size: number;
  readonly previewUrl?: string;
  readonly onRemove?: () => void;
}

export function FileAttachmentChip({ name, size, previewUrl, onRemove }: FileAttachmentChipProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-secondary/40 px-2.5 py-1.5 text-xs text-foreground font-mono">
      {previewUrl ? (
        <img src={previewUrl} alt={name} className="h-8 w-8 rounded object-cover" />
      ) : (
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="max-w-[120px] truncate">{name}</span>
      <span className="text-muted-foreground">{formatFileSize(size)}</span>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label={t("chat.removeFile", { name })}
          className="ml-0.5 h-5 w-5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
