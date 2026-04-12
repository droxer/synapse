import type { Locale } from "@/i18n/types";

export function formatRelativeTimeFromIso(iso: string, locale: Locale): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";

  const diffMs = timestamp - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });

  if (absSeconds < 60) return rtf.format(0, "second");

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

export function formatClockTime(timestampMs: number, locale: Locale): string {
  return new Date(timestampMs).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}
