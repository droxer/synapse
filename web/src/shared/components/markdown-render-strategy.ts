export type MarkdownRenderStrategy = "streaming-light" | "settled";

export function getMarkdownRenderStrategy(isStreaming?: boolean): MarkdownRenderStrategy {
  return isStreaming ? "streaming-light" : "settled";
}
