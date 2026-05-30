"use client";

import { motion } from "framer-motion";
import { ChannelProviderIcon } from "./ChannelProviderIcon";
import { Button } from "@/shared/components/ui/button";
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
    <div className="flex h-full items-center justify-center bg-canvas px-8 welcome-radial-bg">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
      >
        <div className="relative flex h-24 w-24 items-center justify-center">
          <div className="absolute h-24 w-24 rounded-full border border-hairline-soft" />
          <div className="absolute h-16 w-16 rounded-full border border-hairline" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-surface-soft border border-hairline-soft">
            <ChannelProviderIcon provider="telegram" size="lg" />
          </div>
          <div className="absolute top-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-focus/40" />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-focus/40" />
          <div className="absolute left-1 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-focus/40" />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-focus/40" />
        </div>

        <div className="flex w-full flex-col items-center space-y-1.5">
          <h2 className="w-full text-subtitle-lg text-ink-deep">{t("channels.onboarding.title")}</h2>
          <p className="w-full text-body-sm text-steel max-w-[18rem]">
            {t("channels.onboarding.description")}
          </p>
        </div>

        <div className="w-full text-left">
          {steps.map((step, idx) => {
            const isActive = idx === 0;
            return (
              <div key={step.label} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      isActive
                        ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-focus bg-focus text-caption-bold text-on-cobalt"
                        : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-soft text-caption-bold text-stone ring-1 ring-hairline-soft"
                    }
                  >
                    {idx + 1}
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className={`mt-1 w-px flex-1 min-h-[20px] ${
                        isActive ? "bg-focus/30" : "bg-hairline-soft"
                      }`}
                    />
                  )}
                </div>
                <div className="pb-4 min-w-0">
                  <p className={`text-body-sm-bold leading-tight ${isActive ? "text-ink-deep" : "text-steel"}`}>
                    {step.label}
                  </p>
                  <p className="text-caption text-stone mt-0.5">{step.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          onClick={onConfigureBot}
          className="w-full gap-2"
        >
          <ChannelProviderIcon provider="telegram" size="sm" />
          <span>{t("channels.onboarding.cta")}</span>
        </Button>
      </motion.div>
    </div>
  );
}
