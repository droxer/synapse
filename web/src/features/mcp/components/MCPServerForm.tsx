"use client";

import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { TransportToggle } from "./TransportToggle";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useTranslation } from "@/i18n";

interface MCPServerFormProps {
  readonly error: string | null;
  readonly onDismissError: () => void;
  readonly formName: string;
  readonly onFormNameChange: (value: string) => void;
  readonly formTransport: "stdio" | "sse";
  readonly onFormTransportChange: (value: "stdio" | "sse") => void;
  readonly formCommand: string;
  readonly onFormCommandChange: (value: string) => void;
  readonly formUrl: string;
  readonly onFormUrlChange: (value: string) => void;
  readonly submitting: boolean;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  /** HTML id prefix for form fields (avoids id collisions when multiple instances exist) */
  readonly idPrefix?: string;
}

export function MCPServerForm({
  error,
  onDismissError,
  formName,
  onFormNameChange,
  formTransport,
  onFormTransportChange,
  formCommand,
  onFormCommandChange,
  formUrl,
  onFormUrlChange,
  submitting,
  onSubmit,
  onCancel,
  idPrefix = "mcp",
}: MCPServerFormProps) {
  const { t } = useTranslation();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && formName.trim() && !submitting) {
      onSubmit();
    }
  };

  return (
    <div className="space-y-4">
      {/* Error inside form */}
      {error && (
        <ErrorBanner message={error} onDismiss={onDismissError} variant="compact" />
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">
          {t("mcp.name")}
        </Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder={t("mcp.namePlaceholder")}
          value={formName}
          onChange={(e) => onFormNameChange(e.target.value)}
          className="font-mono"
          autoFocus
        />
      </div>

      {/* Transport toggle */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t("mcp.transport")}</Label>
        <TransportToggle value={formTransport} onChange={onFormTransportChange} />
      </div>

      {/* Transport-specific field */}
      {formTransport === "stdio" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-command`} className="text-xs">
            {t("mcp.command")}
          </Label>
          <Input
            id={`${idPrefix}-command`}
            placeholder={t("mcp.commandPlaceholder")}
            value={formCommand}
            onChange={(e) => onFormCommandChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="font-mono"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-url`} className="text-xs">
            {t("mcp.urlLabel")}
          </Label>
          <Input
            id={`${idPrefix}-url`}
            placeholder={t("mcp.urlPlaceholder")}
            value={formUrl}
            onChange={(e) => onFormUrlChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="font-mono"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
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
          disabled={submitting || !formName.trim()}
        >
          {submitting && (
            <span className="mr-1.5 inline-block h-3.5 w-3.5 skeleton-shimmer rounded-sm" />
          )}
          {t("mcp.connect")}
        </Button>
      </div>
    </div>
  );
}
