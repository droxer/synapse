import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { jest } from "@jest/globals";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

import { ArtifactScreenshotGallery } from "./ArtifactScreenshotGallery";

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
});
