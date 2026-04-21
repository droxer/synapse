"use client";

import { motion } from "framer-motion";
import { ChannelProviderIcon } from "./ChannelProviderIcon";
import { useTranslation } from "@/i18n";

export function ChannelsListening() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-background px-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="surface-panel flex w-full max-w-xs flex-col items-center gap-5 p-6 text-center"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-secondary">
            <ChannelProviderIcon provider="telegram" size="lg" />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            <h3 className="text-sm font-semibold text-foreground">{t("channels.listening.activeTitle")}</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground max-w-[22ch] mx-auto">
            {t("channels.listening.activeDescription")}
          </p>
        </div>

        <div className="w-full rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-focus/10">
              <svg className="h-3 w-3 text-focus" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-xs font-medium text-foreground">{t("channels.listening.openTelegram")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground leading-normal">
                {t("channels.listening.openTelegramHintPrefix")}{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs text-foreground">hello</code>
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
