"use client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex h-screen w-screen items-center justify-center bg-[#FAF9F7]">
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="text-xl font-semibold text-[#1C1917]">
              Something went wrong
            </h1>
            <p className="max-w-md text-sm text-[#78716C]">
              {error.message || "A critical error occurred."}
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-[#1C1917] px-4 py-2 text-sm font-medium text-[#FAFAF9] transition-colors hover:bg-[#1C1917]/90"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
