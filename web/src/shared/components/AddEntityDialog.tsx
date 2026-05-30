"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";

interface AddEntityDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: ReactNode;
  readonly headerStatus?: ReactNode;
  readonly contentClassName?: string;
  readonly children: ReactNode;
}

/**
 * Shared shell for "add a new thing" dialogs (MCP servers, skills, etc.).
 * Provides: tinted banner header with icon chip, title, optional status slot,
 * optional description; followed by a content body with consistent padding.
 */
export function AddEntityDialog({
  open,
  onOpenChange,
  icon,
  title,
  description,
  headerStatus,
  contentClassName,
  children,
}: AddEntityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "overflow-hidden p-0 sm:max-w-2xl",
          "grid-cols-[minmax(0,1fr)]",
          contentClassName,
        )}
      >
        <div className="w-full min-w-0 border-b border-hairline-soft/60 bg-surface-soft/30 px-5 py-4 sm:px-6">
          <DialogHeader className="w-full min-w-0 gap-2 pr-8">
            <div className="flex w-full min-w-0 items-center gap-3">
              <div className="chip-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-canvas">
                {icon}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <DialogTitle>{title}</DialogTitle>
                {headerStatus}
              </div>
            </div>
            {description ? (
              <DialogDescription className="block w-full text-pretty">
                {description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
        </div>

        <div className="w-full min-w-0 px-5 py-5 sm:px-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
