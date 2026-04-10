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
    <div className={cn("rounded-lg border border-border-strong bg-background/70 px-3 py-2", className)}>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <ImageIcon className="h-3 w-3" />
        <span>{t("output.imageOutput")}</span>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-md bg-muted/10 p-2">
        {hasArtifacts ? (
          artifactIds.map((aid) => (
            <img
              key={aid}
              src={`/api/conversations/${conversationId}/artifacts/${aid}`}
              alt={t("output.generatedImage")}
              className="max-h-80 rounded-md bg-background object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
          ))
        ) : looksLikeUri ? (
          <img src={output} alt={t("output.agentOutput")} className="max-h-80 rounded-md bg-background object-contain" />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {t("output.imageArtifactHint")}
          </p>
        )}
      </div>
      {!hasArtifacts && !looksLikeUri && (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-sm leading-relaxed text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  );
}
