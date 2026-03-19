"use client";

import { use } from "react";
import { SkillDetailPage } from "@/features/skills/components/SkillDetailPage";

export default function Page({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  return <SkillDetailPage name={decodeURIComponent(name)} />;
}
