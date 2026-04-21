"use client";

import Link from "next/link";
import { Button } from "@/shared/components/ui/button";
import { useTranslation } from "@/i18n";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="surface-panel flex w-full max-w-md flex-col items-center gap-4 px-6 py-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">
          {t("notFound.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("notFound.message")}
        </p>
        <Button asChild>
          <Link href="/">{t("notFound.backHome")}</Link>
        </Button>
      </div>
    </div>
  );
}
