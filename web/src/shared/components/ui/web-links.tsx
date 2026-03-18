import { Globe, ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export interface WebLink {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

interface WebLinksProps {
  readonly query: string;
  readonly results: readonly WebLink[];
  readonly className?: string;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function WebLinks({ query, results, className }: WebLinksProps) {
  return (
    <div className={cn("rounded-md border-l-2 border-l-accent-purple/60 bg-muted/60 px-3 py-2", className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {results.length} result{results.length !== 1 ? "s" : ""} for{" "}
          <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
        </span>
        <span className="flex items-center gap-1 text-micro text-muted-foreground-dim">
          <Globe className="h-3 w-3" />
          Search
        </span>
      </div>
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.url} className="group rounded-md px-2 py-1.5 transition-colors hover:bg-muted">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-user-accent group-hover:underline">
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
