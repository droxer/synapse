"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/shared/components/ui/tooltip";

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <TooltipProvider delayDuration={300}>{children}</TooltipProvider>;
}
