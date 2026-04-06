"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

/** Capture ?desktop=1 from the Tauri loading page and persist it. */
function DesktopModeDetector() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("desktop") === "1") {
      localStorage.setItem("synapse-desktop", "1");
    }
  }, []);
  return null;
}

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <DesktopModeDetector />
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
