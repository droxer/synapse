"use client";

import Link from "next/link";
import { Button } from "@/shared/components/ui/button";
import { useTranslation } from "@/i18n";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas">
      <div className="card-product-feature flex w-full max-w-md flex-col items-center gap-4 text-center">
        <h1 className="w-full text-heading-sm text-ink-deep">
          {t("notFound.title")}
        </h1>
        <p className="w-full text-body-sm text-steel">
          {t("notFound.message")}
        </p>
        <Button asChild variant="marketing">
          <Link href="/">{t("notFound.backHome")}</Link>
        </Button>
      </div>
    </div>
  );
}
