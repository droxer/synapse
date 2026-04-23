"use client";

import type { ChangeEvent, ClipboardEvent } from "react";
import {
  Check,
  FileJson,
  Link2,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
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
  readonly formUrl: string;
  readonly headerCount: number;
  readonly submitting: boolean;
  readonly title: string;
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
  formUrl,
  headerCount,
  submitting,
  title,
  submitLabel,
  onApplySchema,
  onSubmit,
  onCancel,
  idPrefix = "mcp",
}: MCPServerFormProps) {
  const { t } = useTranslation();

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

      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formSchema.trim() ? t("mcp.applySchema") : t("mcp.schema")}
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
          className="min-h-[9rem] resize-y rounded-none border-0 bg-transparent px-4 py-3 font-mono text-xs leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          autoFocus
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
          <span
            className={cn(
              "status-pill",
              headerCount > 0 ? "status-ok" : "status-neutral",
            )}
          >
            {headerCount > 0 ? (
              <Check className="h-3 w-3" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            {headerCount > 0
              ? t("mcp.headersApplied", { count: headerCount })
              : t("mcp.schema")}
          </span>
          <span className="font-mono text-micro text-muted-foreground-dim">
            {formTransport}
          </span>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="label-mono text-muted-foreground-dim">
              {title}
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {formName.trim() || t("mcp.namePlaceholder")}
            </p>
          </div>
          <span className="status-pill status-info">
            <Link2 className="h-3 w-3" />
            {formTransport}
          </span>
        </div>

        <dl className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2">
            <dt className="label-mono text-muted-foreground-dim">
              {t("mcp.name")}
            </dt>
            <dd className="mt-1 truncate font-mono text-sm text-foreground">
              {formName.trim() || t("mcp.namePlaceholder")}
            </dd>
          </div>

          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className="label-mono text-muted-foreground-dim">
              {t("mcp.transport")}
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">
              {formTransport}
            </dd>
          </div>

          <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2 sm:col-span-2">
            <dt className="label-mono text-muted-foreground-dim">
              {t("mcp.urlLabel")}
            </dt>
            <dd className="mt-1 truncate font-mono text-sm text-foreground">
              {formUrl.trim() || t("mcp.urlPlaceholder")}
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-micro text-muted-foreground-dim">
          {formUrl.trim() || t("mcp.urlPlaceholder")}
        </p>
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
