"use client";

import { MainLayoutClient } from "./_components/MainLayoutClient";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayoutClient>{children}</MainLayoutClient>;
}
