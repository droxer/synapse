"use client";

import type { ChangeEvent, ClipboardEvent } from "react";
import {
  Check,
  FileJson,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  OUTPUT_SURFACE_HEADER_CLASSES,
  OUTPUT_SURFACE_ROOT_CLASSES,
} from "@/shared/components/ui/output-surface";
import { useTranslation } from "@/i18n";
import { cn } from "@/shared/lib/utils";
import type { MCPTransport } from "../lib/parse-mcp-config";

interface MCPServerFormProps {
  readonly error: string | null;
  readonly onDismissError: () => void;
  readonly formSchema: string;
  readonly onFormSchemaChange: (value: string) => void;
  readonly formName: string;
  readonly formTransport: MCPTransport;
  readonly headerCount: number;
  readonly submitting: boolean;
  readonly submitLabel: string;
  readonly onApplySchema: (value?: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  /** HTML id prefix for form fields (avoids id collisions when multiple instances exist) */
  readonly idPrefix?: string;
}

export function MCPServerForm({
  error,
  onDismissError,
  formSchema,
  onFormSchemaChange,
  formName,
  formTransport,
  headerCount,
  submitting,
  submitLabel,
  onApplySchema,
  onSubmit,
  onCancel,
  idPrefix = "mcp",
}: MCPServerFormProps) {
  const { t } = useTranslation();
  const parsedName = formName.trim();
  const hasParsedConfig = parsedName.length > 0;
  const schemaHelper = formSchema.trim()
    ? t("mcp.schemaApplyHint")
    : t("mcp.schemaPasteHint");

  const handleSchemaPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.trim()) return;
    e.preventDefault();
    onFormSchemaChange(pasted);
    onApplySchema(pasted);
  };

  return (
    <div className="space-y-5 px-5 py-5 sm:px-6">
      {error && (
        <ErrorBanner message={error} onDismiss={onDismissError} variant="compact" />
      )}

      <section className={cn(OUTPUT_SURFACE_ROOT_CLASSES, "mt-0 bg-background")}>
        <div className={cn(OUTPUT_SURFACE_HEADER_CLASSES, "flex-col gap-3 bg-muted/35 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="chip-muted flex h-8 w-8 shrink-0 items-center justify-center">
              <FileJson className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <Label
                htmlFor={`${idPrefix}-schema`}
                className="label-mono text-muted-foreground-dim"
              >
                {t("mcp.schema")}
              </Label>
              <p className="mt-0.5 max-w-[28rem] text-xs text-muted-foreground">
                {schemaHelper}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onApplySchema()}
            disabled={submitting || !formSchema.trim()}
            className="self-start sm:self-auto"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("mcp.applySchema")}
          </Button>
        </div>

        <Textarea
          id={`${idPrefix}-schema`}
          placeholder={t("mcp.schemaPlaceholder")}
          value={formSchema}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onFormSchemaChange(e.target.value)}
          onPaste={handleSchemaPaste}
          className="min-h-[9rem] resize-y rounded-none border-0 bg-transparent px-4 py-3 font-mono text-xs leading-relaxed focus-visible:border-transparent"
          autoFocus
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={cn(
                "status-pill",
                hasParsedConfig ? "status-info" : "status-neutral",
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              {hasParsedConfig ? parsedName : t("mcp.waitingForConfig")}
            </span>
            {headerCount > 0 && (
              <span className="status-pill status-ok">
                <Check className="h-3 w-3" />
                {t("mcp.headersApplied", { count: headerCount })}
              </span>
            )}
          </div>
          {hasParsedConfig && (
            <span className="font-mono text-micro text-muted-foreground-dim">
              {formTransport}
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            {t("mcp.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={submitting || !formSchema.trim()}
          >
            {submitting && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
