import { Globe, ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import {
  OUTPUT_SURFACE_BODY_CLASSES,
  OUTPUT_SURFACE_FOCUS_CLASSES,
  OUTPUT_SURFACE_HEADER_CLASSES,
  OUTPUT_SURFACE_INNER_DENSE_CLASSES,
  OUTPUT_SURFACE_LABEL_CLASSES,
  OUTPUT_SURFACE_META_CLASSES,
  OUTPUT_SURFACE_ROOT_CLASSES,
} from "./output-surface";

export interface WebLink {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

interface WebLinksProps {
  readonly query: string;
  readonly results: readonly WebLink[];
  readonly className?: string;
  readonly resultsLabel?: string;
  readonly searchLabel?: string;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function WebLinks({ query, results, className, resultsLabel, searchLabel }: WebLinksProps) {
  const { t } = useTranslation();
  const defaultResultsLabel = t(results.length === 1 ? "output.searchResult" : "output.searchResults", {
    count: results.length,
  });
  const resolvedSearchLabel = searchLabel ?? t("output.searchLabel");
  return (
    <div className={cn(OUTPUT_SURFACE_ROOT_CLASSES, className)}>
      <div className={cn(OUTPUT_SURFACE_HEADER_CLASSES, "justify-between gap-2")}>
        <span className={OUTPUT_SURFACE_LABEL_CLASSES}>
          {resultsLabel ?? defaultResultsLabel}{" "}
          <span className="font-medium text-foreground">{`"${query}"`}</span>
        </span>
        <span className={cn("flex items-center gap-1", OUTPUT_SURFACE_META_CLASSES)}>
          <Globe className="h-3 w-3" />
          {resolvedSearchLabel}
        </span>
      </div>
      <div className={OUTPUT_SURFACE_BODY_CLASSES}>
        <ul className="space-y-1.5">
          {results.map((r) => (
            <li key={r.url} className={cn("group transition-colors", OUTPUT_SURFACE_INNER_DENSE_CLASSES, "hover:border-border-strong hover:bg-background")}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("flex items-start gap-2", OUTPUT_SURFACE_FOCUS_CLASSES)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground group-hover:underline">
                    {r.title || getDomain(r.url)}
                  </p>
                  <p className="text-micro text-muted-foreground-dim">{getDomain(r.url)}</p>
                  {r.content && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {r.content}
                    </p>
                  )}
                </div>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground-dim group-hover:text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
