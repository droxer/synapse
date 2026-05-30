import * as React from "react";

import { cn } from "@/shared/lib/utils";

export interface FooterColumn {
  heading: React.ReactNode;
  links: ReadonlyArray<{ label: React.ReactNode; href: string }>;
}

interface FooterRegionProps extends React.ComponentProps<"footer"> {
  columns: ReadonlyArray<FooterColumn>;
  legal?: React.ReactNode;
}

/**
 * DESIGN.md `footer-region` — dense multi-column footer with hairline-soft separators.
 * 6-up on desktop, 3-up on tablet (md), 2-up on mobile.
 */
export function FooterRegion({ columns, legal, className, ...props }: FooterRegionProps) {
  return (
    <footer
      data-slot="footer-region"
      className={cn(
        "w-full border-t border-hairline-soft bg-canvas px-8 py-[64px] text-steel md:px-12",
        className,
      )}
      {...props}
    >
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-3 lg:grid-cols-6">
        {columns.map((col, idx) => (
          <div key={idx} className="flex flex-col gap-3">
            <h4 className="text-body-sm-bold text-ink">{col.heading}</h4>
            <ul className="flex flex-col gap-2">
              {col.links.map((link, lidx) => (
                <li key={lidx}>
                  <a className="text-body-sm text-steel hover:text-ink" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {legal ? (
        <div className="mx-auto mt-12 flex w-full max-w-[1280px] flex-wrap items-center gap-4 border-t border-hairline-soft pt-6 text-stone">
          <span className="text-caption-bold">{legal}</span>
        </div>
      ) : null}
    </footer>
  );
}
