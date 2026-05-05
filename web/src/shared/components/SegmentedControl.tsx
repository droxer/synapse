"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export interface SegmentedControlOption<TValue extends string> {
  readonly value: TValue;
  readonly label: ReactNode;
  readonly ariaLabel?: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
}

interface SegmentedControlProps<TValue extends string> {
  readonly value: TValue;
  readonly options: readonly SegmentedControlOption<TValue>[];
  readonly onValueChange: (value: TValue) => void;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly optionClassName?: string;
  readonly selectedOptionClassName?: string;
  readonly inactiveOptionClassName?: string;
}

export function SegmentedControl<TValue extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className,
  optionClassName,
  selectedOptionClassName,
  inactiveOptionClassName,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => {
              if (!option.disabled && option.value !== value) {
                onValueChange(option.value);
              }
            }}
            className={cn(
              "touch-target inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-[color,background-color,border-color] duration-150",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              selected
                ? cn("border-border bg-secondary text-secondary-foreground", selectedOptionClassName)
                : cn("border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground", inactiveOptionClassName),
              option.disabled && "cursor-not-allowed opacity-60",
              optionClassName,
            )}
          >
            {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
            <span className="whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
