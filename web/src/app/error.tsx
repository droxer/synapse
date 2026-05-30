"use client";

import { Button } from "@/shared/components/ui/button";
import { useTranslation } from "@/i18n";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas">
      <div className="flex w-full max-w-md flex-col items-center gap-4 px-6 text-center">
        <h1 className="w-full text-heading-sm text-ink-deep">
          {t("error.title")}
        </h1>
        <p className="w-full text-body-sm text-steel">
          {error.message || t("error.fallback")}
        </p>
        <Button onClick={reset}>
          {t("error.tryAgain")}
        </Button>
      </div>
    </div>
  );
}
