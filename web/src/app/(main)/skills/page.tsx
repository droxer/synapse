"use client";

import { SkillsPage } from "@/features/skills/components/SkillsPage";
import { ErrorBoundary } from "@/shared/components";

export default function Page() {
  return (
    <ErrorBoundary>
      <SkillsPage />
    </ErrorBoundary>
  );
}
