import type { ChatMessage, PlanStep } from "@/shared/types";

/** True when `thinkingContent` duplicates what is already shown via `thinkingEntries`. */
export function isThinkingContentRedundantWithEntries(
  thinkingContent: string | undefined,
  entries: readonly { readonly content: string }[] | undefined,
): boolean {
  const trimmed = thinkingContent?.trim();
  if (!trimmed || !entries?.length) return false;
  const combined = entries
    .map((e) => e.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!combined) return false;
  if (trimmed === combined) return true;
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  return collapse(trimmed) === collapse(combined);
}

export interface BuildAssistantCopyTextOptions {
  readonly hasEmbeddedPlan: boolean;
  readonly planSteps: readonly PlanStep[];
  readonly imageUrls: readonly string[];
  readonly t: (key: string) => string;
}

/**
 * Plain text for clipboard: reasoning (entries + non-redundant thinkingContent), answer,
 * embedded plan steps, and image URLs when present.
 */
export function buildAssistantCopyText(
  msg: ChatMessage,
  options: BuildAssistantCopyTextOptions,
): string {
  const { hasEmbeddedPlan, planSteps, imageUrls, t } = options;
  const chunks: string[] = [];

  const entryTexts = (msg.thinkingEntries ?? [])
    .map((e) => e.content.trim())
    .filter(Boolean);
  const showOrphan =
    Boolean(msg.thinkingContent?.trim())
    && !isThinkingContentRedundantWithEntries(msg.thinkingContent, msg.thinkingEntries);
  const orphanText = showOrphan ? msg.thinkingContent!.trim() : "";

  if (entryTexts.length > 0 || orphanText) {
    const body = [...entryTexts, orphanText].filter(Boolean).join("\n\n");
    chunks.push(`${t("conversation.copySectionReasoning")}\n\n${body}`);
  }

  const answer = msg.content.trim();
  if (answer.length > 0) {
    chunks.push(`${t("conversation.copySectionAnswer")}\n\n${answer}`);
  }

  if (hasEmbeddedPlan && planSteps.length > 0) {
    const lines = planSteps.map((step, i) => {
      const detail = step.description.trim()
        ? `: ${step.description.trim()}`
        : "";
      return `${i + 1}. [${step.status}] ${step.name.trim()}${detail}`;
    });
    chunks.push(`${t("conversation.copySectionPlan")}\n\n${lines.join("\n")}`);
  }

  if (imageUrls.length > 0) {
    chunks.push(`${t("conversation.copySectionImages")}\n\n${imageUrls.map((u) => `- ${u}`).join("\n")}`);
  }

  return chunks.join("\n\n---\n\n");
}
