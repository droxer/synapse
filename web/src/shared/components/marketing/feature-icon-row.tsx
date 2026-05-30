import * as React from "react";

import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

export interface FeatureIcon {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
}

interface FeatureIconRowProps extends React.ComponentProps<"div"> {
  items: ReadonlyArray<FeatureIcon>;
}

/**
 * DESIGN.md `feature-icon-row` — 4-up reassurance grid with `card-icon-feature` chrome.
 * Collapses to 2-up at sm and 1-up below per the responsive contract.
 */
export function FeatureIconRow({ items, className, ...props }: FeatureIconRowProps) {
  return (
    <div
      data-slot="feature-icon-row"
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      {...props}
    >
      {items.map((item, idx) => (
        <Card key={idx} variant="icon-feature" className="gap-3">
          <div className="text-ink-deep [&_svg]:size-8">{item.icon}</div>
          <h3 className="text-subtitle-lg text-ink-deep">{item.title}</h3>
          <p className="text-body-sm text-steel">{item.description}</p>
        </Card>
      ))}
    </div>
  );
}
