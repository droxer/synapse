import { Globe, ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

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
    <div className={cn("rounded-md border-l-2 border-l-border-strong bg-muted px-2.5 py-1.5", className)}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-micro text-muted-foreground">
          {resultsLabel ?? defaultResultsLabel}{" "}
          <span className="font-medium text-foreground">{`"${query}"`}</span>
        </span>
        <span className="flex items-center gap-1 text-micro text-muted-foreground-dim">
          <Globe className="h-3 w-3" />
          {resolvedSearchLabel}
        </span>
      </div>
      <ul className="space-y-1.5">
        {results.map((r) => (
          <li key={r.url} className="group rounded-md px-2 py-1 transition-colors hover:bg-background/60">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-user-accent group-hover:underline">
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
  );
}
