"use client";

import { motion } from "framer-motion";
import { ChannelProviderIcon } from "./ChannelProviderIcon";

const STEPS = [
  { label: "Configure Bot", sub: "Add your Telegram bot token" },
  { label: "Link Account", sub: "Generate a link token and run /start" },
  { label: "Receive Messages", sub: "Conversations appear here automatically" },
] as const;

interface ChannelsOnboardingProps {
  onConfigureBot: () => void;
}

export function ChannelsOnboarding({ onConfigureBot }: ChannelsOnboardingProps) {
  return (
    <div className="flex h-full items-center justify-center bg-background px-8 welcome-radial-bg">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
      >
        {/* Hero — concentric signal rings */}
        <div className="relative flex h-24 w-24 items-center justify-center">
          <div className="absolute h-24 w-24 rounded-full border border-accent-purple/15 ring-1 ring-accent-purple/8" />
          <div className="absolute h-16 w-16 rounded-full border border-accent-purple/20" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-purple shadow-lg shadow-accent-purple/20">
            <ChannelProviderIcon provider="telegram" size="lg" />
          </div>
          {/* Compass point dots */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent-purple/40" />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent-purple/40" />
          <div className="absolute left-1 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-accent-purple/40" />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-accent-purple/40" />
        </div>

        {/* Heading */}
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Connect Telegram</h2>
          <p className="text-xs leading-relaxed text-muted-foreground max-w-[18rem] mx-auto">
            Route Telegram conversations directly into your AI agent.
          </p>
        </div>

        {/* Steps */}
        <div className="w-full text-left">
          {STEPS.map((step, idx) => {
            const isActive = idx === 0;
            return (
              <div key={step.label} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      isActive
                        ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-purple text-xs font-semibold text-primary-foreground ring-1 ring-accent-purple/30 shadow-sm shadow-accent-purple/20"
                        : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground-dim ring-1 ring-border"
                    }
                  >
                    {idx + 1}
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div
                      className={`mt-1 w-px flex-1 min-h-[20px] ${
                        isActive
                          ? "bg-gradient-to-b from-accent-purple/40 to-transparent"
                          : "bg-border"
                      }`}
                    />
                  )}
                </div>
                <div className="pb-4 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground-dim leading-normal mt-0.5">{step.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onConfigureBot}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-md bg-accent-purple px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-accent-purple/20 transition-[background-color,box-shadow,transform] duration-200 ease-out hover:bg-accent-purple/90 hover:shadow-lg hover:shadow-accent-purple/25 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-purple/40 active:scale-[0.98]"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-200 group-hover:translate-x-full" />
          <ChannelProviderIcon provider="telegram" size="sm" />
          <span className="relative">Configure Bot</span>
        </button>
      </motion.div>
    </div>
  );
}
