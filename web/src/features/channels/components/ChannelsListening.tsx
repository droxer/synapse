"use client";

import { motion } from "framer-motion";
import { ChannelProviderIcon } from "./ChannelProviderIcon";

export function ChannelsListening() {
  return (
    <div className="flex h-full items-center justify-center bg-background px-8 welcome-radial-bg">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="flex w-full max-w-xs flex-col items-center gap-5 text-center"
      >
        {/* Sonar radar animation */}
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span
            className="absolute h-24 w-24 rounded-full border border-focus"
            style={{ animation: "pulsingDotRing 2.5s ease-out infinite 0s" }}
          />
          <span
            className="absolute h-20 w-20 rounded-full border border-focus"
            style={{ animation: "pulsingDotRing 2.5s ease-out infinite 0.6s" }}
          />
          <span
            className="absolute h-14 w-14 rounded-full border border-focus"
            style={{ animation: "pulsingDotRing 2.5s ease-out infinite 1.2s" }}
          />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-purple shadow-lg shadow-accent-purple/20">
            <ChannelProviderIcon provider="telegram" size="lg" />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-[pulsingDotRing_2s_ease-out_infinite] rounded-full bg-accent-emerald opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">Bot is active</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground max-w-[22ch] mx-auto">
            Send any message to your Telegram bot to start a conversation.
          </p>
        </div>

        <div className="w-full rounded-lg border border-border bg-secondary p-3.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent-purple/10">
              <svg className="h-3 w-3 text-accent-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-xs font-medium text-foreground">Open Telegram</p>
              <p className="mt-0.5 text-xs text-muted-foreground leading-normal">
                Search for your bot and send{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs text-foreground">/start</code>
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
