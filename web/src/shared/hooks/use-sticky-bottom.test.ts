import { describe, expect, it } from "@jest/globals";
import { STICKY_BOTTOM_MUTATION_OBSERVER_OPTIONS } from "./use-sticky-bottom";

describe("STICKY_BOTTOM_MUTATION_OBSERVER_OPTIONS", () => {
  it("tracks text-node mutations to keep streaming output pinned", () => {
    expect(STICKY_BOTTOM_MUTATION_OBSERVER_OPTIONS).toEqual({
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
});
