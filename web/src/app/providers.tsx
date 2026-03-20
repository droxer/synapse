"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <I18nProvider>
          <MotionConfig reducedMotion="user">
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          </MotionConfig>
        </I18nProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
