import { cn } from "@/shared/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Synapse product logo — a stylized "S" routed as connected rails
 * inside a rounded container with a subtle gradient.
 */
export function Logo({ size = 28, className }: LogoProps) {
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
        <linearGradient id="synapse-logo-bg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-logo-bg-start, #1B7EF2)" />
          <stop offset="100%" stopColor="var(--color-logo-bg-end, #3B82F6)" />
        </linearGradient>
        <linearGradient id="synapse-logo-node" x1="32" y1="28" x2="96" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-logo-node-start, #DBEAFE)" />
          <stop offset="100%" stopColor="var(--color-logo-node-end, #BFDBFE)" />
        </linearGradient>
      </defs>

      {/* Background rounded square */}
      <rect width="128" height="128" rx="28" fill="url(#synapse-logo-bg)" />

      {/* Stylized "S" — three rails with alternating connectors */}
      <rect x="26" y="24" width="76" height="18" rx="9" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />
      <rect x="84" y="33" width="18" height="30" rx="9" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />
      <rect x="26" y="54" width="76" height="18" rx="9" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />
      <rect x="26" y="63" width="18" height="30" rx="9" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />
      <rect x="26" y="86" width="76" height="18" rx="9" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.95" />

      {/* Synapse node — small signal point on the top rail */}
      <circle cx="95" cy="24" r="9" fill="url(#synapse-logo-node)" />
      <circle cx="95" cy="24" r="3.5" fill="var(--color-logo-glyph, #FFFFFF)" opacity="0.9" />
    </svg>
  );
}

/**
 * Favicon-friendly standalone version (for generating static assets).
 */
export function LogoMark({ size = 48, className }: LogoProps) {
  return <Logo size={size} className={className} />;
}
