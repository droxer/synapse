import { notFound } from "next/navigation";
import { DesignReviewHarness, type DesignReviewTheme } from "../../DesignReviewHarness";

export default async function DesignReviewPreviewPage({
  params,
}: {
  readonly params: Promise<{ theme: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { theme } = await params;
  if (theme !== "light" && theme !== "dark") {
    notFound();
  }

  return <DesignReviewHarness theme={theme as DesignReviewTheme} />;
}
