"use client";

import { Blocks } from "lucide-react";
import { AddEntityDialog } from "@/shared/components/AddEntityDialog";
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
  readonly formTransport: MCPTransport;
  readonly headerCount: number;
  readonly submitting: boolean;
  readonly mode?: "add" | "edit";
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
  formTransport,
  headerCount,
  submitting,
  mode = "add",
  onApplySchema,
  onSubmit,
  onCancel,
  idPrefix,
}: MCPAddServerDialogProps) {
  const { t } = useTranslation();
  const title = mode === "edit" ? t("mcp.editFormTitle") : t("mcp.addFormTitle");
  const submitLabel = mode === "edit" ? t("mcp.save") : t("mcp.connect");

  return (
    <AddEntityDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<Blocks className="h-4 w-4 text-steel" />}
      title={title}
    >
      <MCPServerForm
        error={error}
        onDismissError={onDismissError}
        formSchema={formSchema}
        onFormSchemaChange={onFormSchemaChange}
        formName={formName}
        formTransport={formTransport}
        headerCount={headerCount}
        submitting={submitting}
        submitLabel={submitLabel}
        onApplySchema={onApplySchema}
        onSubmit={onSubmit}
        onCancel={onCancel}
        idPrefix={idPrefix}
      />
    </AddEntityDialog>
  );
}
