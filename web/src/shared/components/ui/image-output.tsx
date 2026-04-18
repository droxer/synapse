import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import {
  OUTPUT_SURFACE_BODY_CLASSES,
  OUTPUT_SURFACE_HEADER_CLASSES,
  OUTPUT_SURFACE_INNER_CLASSES,
  OUTPUT_SURFACE_LABEL_CLASSES,
  OUTPUT_SURFACE_ROOT_CLASSES,
} from "./output-surface";

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
    <div className={cn(OUTPUT_SURFACE_ROOT_CLASSES, className)}>
      <div className={OUTPUT_SURFACE_HEADER_CLASSES}>
        <ImageIcon className="h-3 w-3 text-muted-foreground" />
        <span className={OUTPUT_SURFACE_LABEL_CLASSES}>{t("output.imageOutput")}</span>
      </div>
      <div className={OUTPUT_SURFACE_BODY_CLASSES}>
        <div className={cn(OUTPUT_SURFACE_INNER_CLASSES, "flex flex-col items-center gap-3")}>
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
    </div>
  );
}
