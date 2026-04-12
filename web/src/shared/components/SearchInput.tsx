"use client";

import type { ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface SearchInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly clearLabel?: string;
  readonly className?: string;
}

export function SearchInput({ value, onChange, placeholder, clearLabel = "Clear filter", className }: SearchInputProps) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5", className)}>
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-32 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
