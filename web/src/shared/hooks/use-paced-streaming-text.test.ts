import { describe, expect, it } from "@jest/globals";
import {
  getNextPacedStreamingText,
  getPacedStreamingChunkSize,
} from "./use-paced-streaming-text";

describe("paced streaming text", () => {
  it("uses bounded chunk sizes", () => {
    expect(getPacedStreamingChunkSize(5)).toBe(5);
    expect(getPacedStreamingChunkSize(12)).toBe(12);
    expect(getPacedStreamingChunkSize(80)).toBeLessThanOrEqual(48);
    expect(getPacedStreamingChunkSize(80)).toBeGreaterThanOrEqual(12);
  });

  it("reveals content incrementally while backlog remains", () => {
    const target = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const next = getNextPacedStreamingText("", target);

    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThan(target.length);
    expect(target.startsWith(next)).toBe(true);
  });

  it("flushes to the target text when the current text no longer matches the prefix", () => {
    expect(
      getNextPacedStreamingText("stale text", "fresh answer"),
    ).toBe("fresh answer");
  });
});
