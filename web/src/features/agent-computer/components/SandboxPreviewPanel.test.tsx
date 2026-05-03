import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type React from "react";

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "preview.title": "Sandbox preview",
        "preview.frameTitle": "Interactive sandbox preview",
        "preview.reload": "Reload preview",
        "preview.open": "Open preview in new tab",
        "preview.inactive": "No active preview.",
        "preview.noUrl": "Preview started, but no URL was provided.",
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock("framer-motion", () => ({
  __esModule: true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const { SandboxPreviewPanel } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./AgentComputerPanel");

describe("SandboxPreviewPanel", () => {
  it("renders the active preview iframe and controls", () => {
    const html = renderToStaticMarkup(
      <SandboxPreviewPanel
        previewSession={{
          active: true,
          url: "/api/conversations/c1/preview/?_port=3001",
          port: 3001,
          directory: "/workspace/app",
        }}
      />,
    );

    expect(html).toContain('src="/api/conversations/c1/preview/?_port=3001"');
    expect(html).toContain('title="Interactive sandbox preview"');
    expect(html).toContain(
      'sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"',
    );
    expect(html).toContain('aria-label="Reload preview"');
    expect(html).toContain('aria-label="Open preview in new tab"');
  });

  it("renders a clear empty state when active preview has no URL", () => {
    const html = renderToStaticMarkup(
      <SandboxPreviewPanel
        previewSession={{
          active: true,
          port: 3001,
          directory: "/workspace/app",
        }}
      />,
    );

    expect(html).toContain("Preview started, but no URL was provided.");
    expect(html).not.toContain("<iframe");
  });
});
