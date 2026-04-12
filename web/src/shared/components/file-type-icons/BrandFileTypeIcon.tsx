"use client";

import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { fileExtension, fileIcon } from "@/features/agent-computer/lib/artifact-helpers";
import { cn } from "@/shared/lib/utils";
import type { BrandIconData, BrandMimeRule } from "./types";
import { officeExtensionIconMap, officeMimeRules } from "./icons-office";
import { codeExtensionIconMap, codeMimeRules } from "./icons-code";
import { webExtensionIconMap, webMimeRules } from "./icons-web";
import { dataExtensionIconMap, dataMimeRules } from "./icons-data";

const EXTENSION_ICON_MAP: Record<string, BrandIconData> = {
  ...officeExtensionIconMap,
  ...codeExtensionIconMap,
  ...webExtensionIconMap,
  ...dataExtensionIconMap,
};

const MIME_ICON_RULES: readonly BrandMimeRule[] = [
  ...officeMimeRules,
  ...codeMimeRules,
  ...webMimeRules,
  ...dataMimeRules,
];

// Paths are copied from Simple Icons (CC0-1.0). Trademarks belong to their owners; no endorsement implied.
export function resolveBrandIcon(name: string, contentType: string): BrandIconData | null {
  const ext = fileExtension(name);
  if (ext) {
    const icon = EXTENSION_ICON_MAP[ext];
    if (icon) {
      return icon;
    }
  }

  for (const rule of MIME_ICON_RULES) {
    if (rule.test(contentType)) {
      return rule.icon;
    }
  }

  return null;
}

interface BrandFileTypeIconProps {
  readonly name: string;
  readonly contentType: string;
  readonly className?: string;
  readonly size?: number;
  readonly decorative?: boolean;
}

export function BrandFileTypeIcon({
  name,
  contentType,
  className,
  size = 20,
  decorative = true,
}: BrandFileTypeIconProps) {
  const icon = resolveBrandIcon(name, contentType);

  if (icon) {
    return (
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-hidden={decorative}
        aria-label={decorative ? undefined : icon.title}
        focusable="false"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
      >
        <path fill="currentColor" d={icon.path} />
      </svg>
    );
  }

  const FallbackIcon = fileIcon(contentType, name) as ComponentType<LucideProps>;
  return (
    <FallbackIcon
      aria-hidden={decorative}
      aria-label={decorative ? undefined : `${fileExtension(name) || "file"} file`}
      className={cn("shrink-0", className)}
      size={size}
    />
  );
}
