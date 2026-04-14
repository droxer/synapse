"use client";

import { geistSans, geistMono, notoSansSC, notoSansTC } from "./fonts";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansTC.variable}`}
    >
      <body className="font-sans antialiased bg-background text-foreground">
        <div className="flex h-screen w-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="text-xl font-semibold text-foreground">
              Something went wrong
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              {error.message || "A critical error occurred."}
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
