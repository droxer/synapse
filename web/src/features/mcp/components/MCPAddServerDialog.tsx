"use client";

import { Blocks, Globe, Radio } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { useTranslation } from "@/i18n";
import type { MCPTransport } from "../lib/parse-mcp-config";
import { MCPServerForm } from "./MCPServerForm";

interface MCPAddServerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly error: string | null;
  readonly onDismissError: () => void;
  readonly formSchema: string;
  readonly onFormSchemaChange: (value: string) => void;
  readonly formName: string;
  readonly onFormNameChange: (value: string) => void;
  readonly formTransport: MCPTransport;
  readonly onFormTransportChange: (value: MCPTransport) => void;
  readonly formUrl: string;
  readonly onFormUrlChange: (value: string) => void;
  readonly headerCount: number;
  readonly submitting: boolean;
  readonly onApplySchema: (value?: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly idPrefix?: string;
}

export function MCPAddServerDialog({
  open,
  onOpenChange,
  error,
  onDismissError,
  formSchema,
  onFormSchemaChange,
  formName,
  onFormNameChange,
  formTransport,
  onFormTransportChange,
  formUrl,
  onFormUrlChange,
  headerCount,
  submitting,
  onApplySchema,
  onSubmit,
  onCancel,
  idPrefix,
}: MCPAddServerDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-b border-border bg-muted/30 px-5 py-4 sm:px-6">
          <DialogHeader className="gap-3 pr-8">
            <div className="flex items-start gap-3">
              <div className="chip-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background">
                <Blocks className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{t("mcp.addFormTitle")}</DialogTitle>
                  <span className="status-pill status-info">
                    <Globe className="h-3 w-3" />
                    HTTP
                  </span>
                  <span className="status-pill status-neutral">
                    <Radio className="h-3 w-3" />
                    SSE
                  </span>
                </div>
                <DialogDescription className="mt-1 max-w-xl">
                  {t("mcp.subtitle")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <MCPServerForm
          error={error}
          onDismissError={onDismissError}
          formSchema={formSchema}
          onFormSchemaChange={onFormSchemaChange}
          formName={formName}
          onFormNameChange={onFormNameChange}
          formTransport={formTransport}
          onFormTransportChange={onFormTransportChange}
          formUrl={formUrl}
          onFormUrlChange={onFormUrlChange}
          headerCount={headerCount}
          submitting={submitting}
          onApplySchema={onApplySchema}
          onSubmit={onSubmit}
          onCancel={onCancel}
          idPrefix={idPrefix}
        />
      </DialogContent>
    </Dialog>
  );
}
