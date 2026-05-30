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

/** In-page filter input — matches DESIGN.md Input contract (not search-pill). */
export function SearchInput({ value, onChange, placeholder, clearLabel = "Clear filter", className }: SearchInputProps) {
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-2 rounded-lg border border-hairline bg-canvas px-3 transition-[border-color,box-shadow]",
        "focus-within:border-2 focus-within:border-fb-blue focus-within:px-[11px]",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-steel" />
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-32 flex-1 bg-transparent text-body-sm text-ink placeholder:text-stone outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
          className="rounded-full p-1 text-steel hover:text-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
