import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("renders a labelled pressed-button group with touch targets", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        ariaLabel="View mode"
        value="grid"
        onValueChange={() => undefined}
        options={[
          { value: "grid", label: "Grid" },
          { value: "list", label: "List" },
        ]}
      />,
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="View mode"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("touch-target");
  });
});
