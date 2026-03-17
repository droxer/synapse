"use client";

import { Terminal, Radio } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

interface TransportToggleProps {
  readonly value: "stdio" | "sse";
  readonly onChange: (value: "stdio" | "sse") => void;
}

export function TransportToggle({ value, onChange }: TransportToggleProps) {
  return (
    <div className="flex gap-1.5">
      <Button
        type="button"
        variant={value === "stdio" ? "default" : "secondary"}
        size="sm"
        onClick={() => onChange("stdio")}
        className={
          value === "stdio"
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "text-muted-foreground hover:text-foreground"
        }
      >
        <Terminal className="h-3 w-3" />
        stdio
      </Button>
      <Button
        type="button"
        variant={value === "sse" ? "default" : "secondary"}
        size="sm"
        onClick={() => onChange("sse")}
        className={
          value === "sse"
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "text-muted-foreground hover:text-foreground"
        }
      >
        <Radio className="h-3 w-3" />
        sse
      </Button>
    </div>
  );
}
