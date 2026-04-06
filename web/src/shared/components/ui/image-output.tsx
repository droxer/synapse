import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface ImageOutputProps {
  readonly output: string;
  readonly conversationId?: string | null;
  readonly artifactIds?: string[];
  readonly className?: string;
}

export function ImageOutput({ output, conversationId, artifactIds, className }: ImageOutputProps) {
  const { t } = useTranslation();
  const hasArtifacts = artifactIds && artifactIds.length > 0 && conversationId;
  const looksLikeUri = output.startsWith("data:") || output.startsWith("http");

  return (
    <div className={cn("rounded-md border-l-2 border-l-focus bg-muted px-2.5 py-1.5", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-micro text-muted-foreground-dim">
        <ImageIcon className="h-3 w-3" />
        <span>{t("output.imageOutput")}</span>
      </div>
      <div className="flex flex-col items-center gap-3 rounded border border-border bg-background p-2">
        {hasArtifacts ? (
          artifactIds.map((aid) => (
            <img
              key={aid}
              src={`/api/conversations/${conversationId}/artifacts/${aid}`}
              alt={t("output.generatedImage")}
              className="max-h-80 rounded object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ))
        ) : looksLikeUri ? (
          <img src={output} alt={t("output.agentOutput")} className="max-h-80 rounded object-contain" />
        ) : (
          <p className="text-xs text-muted-foreground italic">
            {t("output.imageArtifactHint")}
          </p>
        )}
      </div>
      {!hasArtifacts && !looksLikeUri && (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  );
}
