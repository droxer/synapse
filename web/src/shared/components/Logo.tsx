import { cn } from "@/shared/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
  /**
   * Select logo lockup based on surrounding surface.
   * - auto: follows theme tokens (`--logo-bg` / `--logo-glyph`)
   * - on-light: black container + white glyph
   * - on-dark: white container + black glyph
   * - neutral: dark-neutral container + white glyph
   */
  tone?: "auto" | "on-light" | "on-dark" | "neutral";
}

/**
 * Synapse product logo in strict monochrome lockups.
 */
export function Logo({ size = 28, className, tone = "auto" }: LogoProps) {
  const paletteByTone = {
    auto: {
      background: "var(--logo-bg, var(--logo-black, #0A0A0A))",
      glyph: "var(--logo-glyph, var(--logo-white, #FFFFFF))",
    },
    "on-light": {
      background: "var(--logo-black, #0A0A0A)",
      glyph: "var(--logo-white, #FFFFFF)",
    },
    "on-dark": {
      background: "var(--logo-white, #FFFFFF)",
      glyph: "var(--logo-black, #0A0A0A)",
    },
    neutral: {
      background: "var(--logo-neutral-700, #2B2B2B)",
      glyph: "var(--logo-white, #FFFFFF)",
    },
  } as const;
  const palette = paletteByTone[tone];

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
      {/* Background rounded square */}
      <rect width="128" height="128" rx="28" fill={palette.background} />

      {/* Stylized "S" — three rails with alternating connectors */}
      <rect x="26" y="24" width="76" height="18" rx="9" fill={palette.glyph} opacity="0.96" />
      <rect x="84" y="33" width="18" height="30" rx="9" fill={palette.glyph} opacity="0.96" />
      <rect x="26" y="54" width="76" height="18" rx="9" fill={palette.glyph} opacity="0.96" />
      <rect x="26" y="63" width="18" height="30" rx="9" fill={palette.glyph} opacity="0.96" />
      <rect x="26" y="86" width="76" height="18" rx="9" fill={palette.glyph} opacity="0.96" />

      {/* Synapse node — small signal point on the top rail */}
      <circle cx="95" cy="24" r="9" fill={palette.glyph} />
      <circle cx="95" cy="24" r="3.5" fill={palette.background} opacity="0.9" />
    </svg>
  );
}

/**
 * Favicon-friendly standalone version (for generating static assets).
 */
export function LogoMark({ size = 48, className }: LogoProps) {
  return <Logo size={size} className={className} />;
}
