import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { jest } from "@jest/globals";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

jest.mock("@/shared/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content, className }: { content: string; className?: string }) => (
    <div className={className}>{content}</div>
  ),
}));

import { ArtifactScreenshotGallery } from "./ArtifactScreenshotGallery";
import { ComputerUseOutput } from "./ComputerUseOutput";
import {
  OUTPUT_CARD_BASE_CLASSES,
  OUTPUT_CARD_INNER_CLASSES,
  OUTPUT_HEADER_ROW_CLASSES,
} from "../lib/format-tools";

describe("tool screenshot renderers", () => {
  it("renders screenshots in a stable reserved-space container", () => {
    const html = renderToStaticMarkup(
      <ArtifactScreenshotGallery
        conversationId="conv-1"
        artifactIds={["artifact-1", "artifact-2"]}
        alt="Generated image"
      />,
    );

    expect(html).toContain("aspect-video");
    expect(html).toContain("/api/conversations/conv-1/artifacts/artifact-1");
    expect(html).toContain("/api/conversations/conv-1/artifacts/artifact-2");
  });

  it("uses the shared output-surface contract for agent-computer renderers", () => {
    const computerHtml = renderToStaticMarkup(
      <ComputerUseOutput output="clicked" toolName="computer_action" computerUseMetadata={{ action: "click", x: 1, y: 2 }} />,
    );

    expect(OUTPUT_CARD_BASE_CLASSES).toContain("surface-panel");
    expect(OUTPUT_HEADER_ROW_CLASSES).toContain("border-b border-border");
    expect(OUTPUT_CARD_INNER_CLASSES).toContain("rounded-lg border border-border bg-muted");
    expect(computerHtml).toContain("surface-panel");
    expect(computerHtml).toContain("rounded-lg border border-border bg-muted");
  });
});
