import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { ToolArgsDisplay } from "./ToolArgsDisplay";

describe("ToolArgsDisplay typography", () => {
  it("renders scalar values with body text and keys as metadata", () => {
    const html = renderToStaticMarkup(
      <ToolArgsDisplay input={{ path: "/tmp/report.md", verbose: true }} />,
    );

    expect(html).toContain("text-micro text-muted-foreground-dim");
    expect(html).toContain("text-sm text-foreground");
    expect(html).toContain("text-sm text-accent-emerald");
    expect(html).not.toContain("text-xs");
  });

  it("keeps structured payloads monospace and compact scalar values readable", () => {
    const html = renderToStaticMarkup(
      <ToolArgsDisplay
        compact
        input={{
          content: { foo: "bar", count: 2 },
          name: "frontend-design",
        }}
      />,
    );

    expect(html).toContain("font-mono text-micro");
    expect(html).toContain("break-words [overflow-wrap:anywhere] text-sm text-foreground");
    expect(html).toContain("text-micro text-muted-foreground-dim");
  });
});
