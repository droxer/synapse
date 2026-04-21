import type { ReactNode } from "react";

/**
 * Minimal stub for Jest — real markdown is exercised via the app / integration.
 */
export default function ReactMarkdown({ children }: { children?: string }): ReactNode {
  return <div data-testid="parsed-markdown">{children}</div>;
}
