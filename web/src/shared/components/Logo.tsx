"use client";

import { useId } from "react";
import { cn } from "@/shared/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * HiAgent product logo — a stylized "H" formed by two abstract agent nodes
 * connected by a bridge, inside a rounded container with a subtle gradient.
 */
export function Logo({ size = 28, className }: LogoProps) {
  const uniqueId = useId().replace(/:/g, "");
  const bgGradientId = `logo-bg-${uniqueId}`;
  const nodeGradientId = `logo-node-${uniqueId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgGradientId} x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-logo-bg-start, #1B7EF2)" />
          <stop offset="100%" stopColor="var(--color-logo-bg-end, #3B82F6)" />
        </linearGradient>
        <linearGradient id={nodeGradientId} x1="32" y1="28" x2="96" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-logo-node-start, #DBEAFE)" />
          <stop offset="100%" stopColor="var(--color-logo-node-end, #BFDBFE)" />
        </linearGradient>
      </defs>

      {/* Background rounded square */}
      <rect width="128" height="128" rx="28" fill={`url(#${bgGradientId})`} />

      {/* Stylized "H" — two vertical pillars connected by a crossbar */}
      {/* Left pillar */}
      <rect x="30" y="30" width="20" height="68" rx="10" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />

      {/* Right pillar */}
      <rect x="78" y="30" width="20" height="68" rx="10" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />

      {/* Crossbar connecting pillars */}
      <rect x="40" y="52" width="48" height="16" rx="8" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />

      {/* Agent node — small circle on top-right pillar */}
      <circle cx="88" cy="30" r="10" fill={`url(#${nodeGradientId})`} />

      {/* Subtle inner glow dot at the agent node center */}
      <circle cx="88" cy="30" r="4" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.9" />
    </svg>
  );
}

/**
 * Favicon-friendly standalone version (for generating static assets).
 */
export function LogoMark({ size = 48, className }: LogoProps) {
  return <Logo size={size} className={className} />;
}
