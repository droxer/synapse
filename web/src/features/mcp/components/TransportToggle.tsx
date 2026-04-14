"use client";

import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface TransportToggleProps {
  readonly value: "stdio" | "sse";
  readonly onChange: (value: "stdio" | "sse") => void;
}

export function TransportToggle({ value, onChange }: TransportToggleProps) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-1 rounded-md bg-secondary p-1">
      {(["sse", "stdio"] as const).map((transport) => (
        <button
          key={transport}
          type="button"
          onClick={() => { if (transport !== "stdio") onChange(transport); }}
          disabled={transport === "stdio"}
          className={cn(
            "flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-[color,background-color] duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            value === transport
              ? "border border-border bg-background text-foreground"
              : transport === "stdio"
                ? "cursor-not-allowed text-muted-foreground-dim"
                : "text-muted-foreground hover:text-foreground",
          )}
        >
          {transport === "stdio" ? t("mcp.stdioComingSoon") : "sse"}
        </button>
      ))}
    </div>
  );
}
