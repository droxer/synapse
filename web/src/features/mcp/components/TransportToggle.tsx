"use client";

import { Globe, Radio } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { MCPTransport } from "../lib/parse-mcp-config";

interface TransportToggleProps {
  readonly value: MCPTransport;
  readonly onChange: (value: MCPTransport) => void;
}

export function TransportToggle({ value, onChange }: TransportToggleProps) {
  const transports = [
    { value: "streamablehttp", label: "streamablehttp", Icon: Globe },
    { value: "sse", label: "sse", Icon: Radio },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1">
      {transports.map(({ value: transport, label, Icon }) => (
        <button
          key={transport}
          type="button"
          onClick={() => onChange(transport)}
          className={cn(
            "flex min-h-9 items-center justify-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs font-medium transition-[border-color,color,background-color,box-shadow] duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            value === transport
              ? "border border-border-strong bg-background text-foreground shadow-card"
              : "border border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}
