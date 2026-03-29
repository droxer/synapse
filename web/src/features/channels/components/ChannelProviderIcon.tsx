"use client";

import { cn } from "@/shared/lib/utils";

export type ChannelProvider = "telegram" | "whatsapp" | "discord" | "slack" | "wechat" | string;

interface ProviderConfig {
  label: string;
  bgColor: string;
  textColor: string;
  gradient: string;
  icon: React.ReactNode;
}

function TelegramSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
        fill="currentColor"
        opacity="0"
      />
      <path
        d="M9.78 15.96l-.39 3.69c.56 0 .8-.24 1.1-.53l2.64-2.52 5.47 3.99c1 .56 1.72.26 1.99-.93l3.62-16.9v-.01c.31-1.44-.52-2-1.49-1.64L1.28 8.52c-1.39.54-1.37 1.32-.24 1.67l4.93 1.54 11.45-7.19c.54-.35 1.03-.16.63.2"
        fill="white"
      />
    </svg>
  );
}

function WhatsAppSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function DiscordSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.12 18.117a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function SlackSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

function WeChatSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-5.972 2.746-7.817 1.652-1.18 3.58-1.68 5.386-1.386-1.026-3.217-4.506-5.425-8.943-5.425zm-2.65 3.38a.96.96 0 1 1 0 1.919.96.96 0 0 1 0-1.919zm5.3 0a.96.96 0 1 1 0 1.919.96.96 0 0 1 0-1.919zM24 14.48c0-3.45-3.386-6.247-7.565-6.247-4.18 0-7.568 2.798-7.568 6.247 0 3.448 3.389 6.247 7.568 6.247.867 0 1.7-.122 2.476-.342a.717.717 0 0 1 .59.08l1.57.917a.267.267 0 0 0 .137.046c.133 0 .24-.107.24-.245 0-.06-.024-.12-.04-.176l-.32-1.218a.49.49 0 0 1 .176-.548C23.005 18.18 24 16.43 24 14.48zm-9.898-1.151a.793.793 0 1 1 0-1.586.793.793 0 0 1 0 1.586zm4.666 0a.793.793 0 1 1 0-1.586.793.793 0 0 1 0 1.586z" />
    </svg>
  );
}

function GenericChannelSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  telegram: {
    label: "Telegram",
    bgColor: "#2AABEE",
    textColor: "#ffffff",
    gradient: "linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)",
    icon: <TelegramSVG size={16} />,
  },
  whatsapp: {
    label: "WhatsApp",
    bgColor: "#25D366",
    textColor: "#ffffff",
    gradient: "linear-gradient(135deg, #25D366 0%, #1DA851 100%)",
    icon: <WhatsAppSVG size={16} />,
  },
  discord: {
    label: "Discord",
    bgColor: "#5865F2",
    textColor: "#ffffff",
    gradient: "linear-gradient(135deg, #5865F2 0%, #4752C4 100%)",
    icon: <DiscordSVG size={16} />,
  },
  slack: {
    label: "Slack",
    bgColor: "#4A154B",
    textColor: "#ffffff",
    gradient: "linear-gradient(135deg, #E01E5A 0%, #ECB22E 50%, #2EB67D 75%, #36C5F0 100%)",
    icon: <SlackSVG size={16} />,
  },
  wechat: {
    label: "WeChat",
    bgColor: "#07C160",
    textColor: "#ffffff",
    gradient: "linear-gradient(135deg, #07C160 0%, #06AE56 100%)",
    icon: <WeChatSVG size={16} />,
  },
};

function getProviderConfig(provider: string): ProviderConfig {
  return (
    PROVIDER_CONFIGS[provider.toLowerCase()] ?? {
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      bgColor: "#64748B",
      textColor: "#ffffff",
      gradient: "linear-gradient(135deg, #64748B 0%, #475569 100%)",
      icon: <GenericChannelSVG size={16} />,
    }
  );
}

interface ChannelProviderIconProps {
  provider: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showLabel?: boolean;
}

const SIZE_MAP = {
  sm: { container: "h-6 w-6", iconSize: 12 },
  md: { container: "h-8 w-8", iconSize: 16 },
  lg: { container: "h-10 w-10", iconSize: 20 },
  xl: { container: "h-14 w-14", iconSize: 28 },
};

export function ChannelProviderIcon({
  provider,
  size = "md",
  className,
  showLabel = false,
}: ChannelProviderIconProps) {
  const config = getProviderConfig(provider);
  const { container } = SIZE_MAP[size];
  const iconSize = SIZE_MAP[size].iconSize;

  const iconEl =
    provider.toLowerCase() === "telegram" ? <TelegramSVG size={iconSize} />
    : provider.toLowerCase() === "whatsapp" ? <WhatsAppSVG size={iconSize} />
    : provider.toLowerCase() === "discord" ? <DiscordSVG size={iconSize} />
    : provider.toLowerCase() === "slack" ? <SlackSVG size={iconSize} />
    : provider.toLowerCase() === "wechat" ? <WeChatSVG size={iconSize} />
    : <GenericChannelSVG size={iconSize} />;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn("flex shrink-0 items-center justify-center rounded-xl shadow-sm", container)}
        style={{ background: config.gradient }}
      >
        {iconEl}
      </div>
      {showLabel && (
        <span className="text-sm font-medium text-foreground">{config.label}</span>
      )}
    </div>
  );
}

export function ChannelProviderBadge({ provider }: { provider: string }) {
  const config = getProviderConfig(provider);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: `${config.bgColor}15`,
        color: config.bgColor,
        border: `1px solid ${config.bgColor}30`,
      }}
    >
      <span
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{ background: config.bgColor }}
      >
        <span style={{ transform: "scale(0.7)", display: "flex" }}>
          {provider.toLowerCase() === "telegram" ? <TelegramSVG size={10} />
          : provider.toLowerCase() === "whatsapp" ? <WhatsAppSVG size={10} />
          : provider.toLowerCase() === "discord" ? <DiscordSVG size={10} />
          : provider.toLowerCase() === "slack" ? <SlackSVG size={10} />
          : <GenericChannelSVG size={10} />}
        </span>
      </span>
      {config.label}
    </span>
  );
}

export function getProviderColor(provider: string): string {
  return getProviderConfig(provider).bgColor;
}

export function getProviderLabel(provider: string): string {
  return getProviderConfig(provider).label;
}
