import { notFound } from "next/navigation";
import { Bot } from "lucide-react";

const themePreviews = [
  {
    id: "light",
    title: "Light theme",
    description: "Token, layout, progress, and DONE states on the light surface.",
  },
  {
    id: "dark",
    title: "Dark theme",
    description: "The same authenticated-state fixture on the dark surface.",
  },
] as const;

export default function DesignReviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main id="main" className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-start gap-3">
          <div className="chip-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
            <Bot className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="label-mono text-muted-foreground-dim">Local visual fixture</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Frontend design review</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Development-only authenticated UI fixture with side-by-side light and dark theme previews.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 xl:grid-cols-2">
        {themePreviews.map((preview) => (
          <article key={preview.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{preview.title}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{preview.description}</p>
              </div>
              <a
                href={`/design-review/preview/${preview.id}`}
                className="text-xs font-medium text-focus underline-offset-4 hover:text-focus/80 hover:underline"
              >
                Open full preview
              </a>
            </div>
            <iframe
              title={`${preview.title} design review preview`}
              src={`/design-review/preview/${preview.id}`}
              className="h-[46rem] w-full border-0 bg-background"
            />
          </article>
        ))}
      </section>
    </main>
  );
}
