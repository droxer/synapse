export function formatRelativeDate(
  dateStr: string,
  locale: string,
): { relative: string; absolute: string } {
  const date = new Date(dateStr);
  const absolute = date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  let relative: string;
  if (diffSec < 60) relative = rtf.format(0, "second");
  else if (diffMin < 60) relative = rtf.format(-diffMin, "minute");
  else if (diffHr < 24) relative = rtf.format(-diffHr, "hour");
  else if (diffDays < 7) relative = rtf.format(-diffDays, "day");
  else relative = absolute;

  return { relative, absolute };
}
