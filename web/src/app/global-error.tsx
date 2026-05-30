"use client";

import { montserrat, geistMono, notoSansSC, notoSansTC } from "./fonts";
import { Button } from "@/shared/components/ui/button";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansTC.variable}`}
    >
      <body className="font-sans antialiased bg-canvas text-ink-deep">
        <div className="flex h-screen w-screen items-center justify-center">
          <div className="flex w-full max-w-md flex-col items-center gap-4 px-6 text-center">
            <h1 className="w-full text-heading-sm text-ink-deep">
              Something went wrong
            </h1>
            <p className="w-full text-body-sm text-steel">
              {error.message || "A critical error occurred."}
            </p>
            <Button onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
