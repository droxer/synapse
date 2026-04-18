"use client";

import { motion } from "framer-motion";
import { ChannelProviderIcon } from "./ChannelProviderIcon";
import { useTranslation } from "@/i18n";

interface ChannelsOnboardingProps {
  onConfigureBot: () => void;
}

export function ChannelsOnboarding({ onConfigureBot }: ChannelsOnboardingProps) {
  const { t } = useTranslation();
  const steps = [
    { label: t("channels.onboarding.step1.label"), sub: t("channels.onboarding.step1.sub") },
    { label: t("channels.onboarding.step2.label"), sub: t("channels.onboarding.step2.sub") },
    { label: t("channels.onboarding.step3.label"), sub: t("channels.onboarding.step3.sub") },
  ] as const;

  return (
    <div className="flex h-full items-center justify-center bg-background px-8 welcome-radial-bg">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
      >
        {/* Hero — simplified concentric rings */}
        <div className="relative flex h-24 w-24 items-center justify-center">
          <div className="absolute h-24 w-24 rounded-full border border-border" />
          <div className="absolute h-16 w-16 rounded-full border border-border-strong" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-muted border border-border">
            <ChannelProviderIcon provider="telegram" size="lg" />
          </div>
          {/* Compass point dots */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-focus/40" />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-focus/40" />
          <div className="absolute left-1 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-focus/40" />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-focus/40" />
        </div>

        {/* Heading */}
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t("channels.onboarding.title")}</h2>
          <p className="text-caption leading-relaxed text-muted-foreground max-w-[18rem] mx-auto">
            {t("channels.onboarding.description")}
          </p>
        </div>

        {/* Steps */}
        <div className="w-full text-left">
          {steps.map((step, idx) => {
            const isActive = idx === 0;
            return (
              <div key={step.label} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      isActive
                        ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-focus text-xs font-semibold text-primary-foreground ring-1 ring-focus/30 shadow-sm shadow-focus/20"
                        : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground-dim ring-1 ring-border"
                    }
                  >
                    {idx + 1}
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className={`mt-1 w-px flex-1 min-h-[20px] ${
                        isActive
                          ? "bg-gradient-to-b from-focus/40 to-transparent"
                          : "bg-border"
                      }`}
                    />
                  )}
                </div>
                <div className="pb-4 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </p>
                  <p className="text-caption text-muted-foreground-dim leading-normal mt-0.5">{step.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          data-slot="button"
          type="button"
          onClick={onConfigureBot}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-200 ease-out hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-200 group-hover:translate-x-full" />
          <ChannelProviderIcon provider="telegram" size="sm" />
          <span className="relative">{t("channels.onboarding.cta")}</span>
        </button>
      </motion.div>
    </div>
  );
}
