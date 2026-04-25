import type { ChatMessage, PlanStep } from "@/shared/types";
import { isThinkingContentRedundantWithEntries } from "./thinking-display";
export { isThinkingContentRedundantWithEntries } from "./thinking-display";

export interface BuildAssistantCopyTextOptions {
  readonly hasEmbeddedPlan: boolean;
  readonly planSteps: readonly PlanStep[];
  readonly imageUrls: readonly string[];
  readonly t: (key: string) => string;
}

const PLAN_STATUS_I18N: Record<PlanStep["status"], string> = {
  pending: "plan.statusPending",
  running: "plan.statusRunning",
  complete: "plan.statusComplete",
  error: "plan.statusError",
  skipped: "plan.statusSkipped",
  replan_required: "plan.statusReplanRequired",
};

function getPlanStatusLabel(status: PlanStep["status"], t: (key: string) => string): string {
  return t(PLAN_STATUS_I18N[status]);
}

function getLocalizedPlanStepName(step: PlanStep, t: (key: string) => string): string {
  return step.nameI18nKey ? t(step.nameI18nKey) : step.name;
}

function getLocalizedPlanStepDescription(step: PlanStep, t: (key: string) => string): string {
  return step.descriptionI18nKey ? t(step.descriptionI18nKey) : step.description;
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
      const description = getLocalizedPlanStepDescription(step, t).trim();
      const detail = description
        ? `: ${description}`
        : "";
      return `${i + 1}. [${getPlanStatusLabel(step.status, t)}] ${getLocalizedPlanStepName(step, t).trim()}${detail}`;
    });
    chunks.push(`${t("conversation.copySectionPlan")}\n\n${lines.join("\n")}`);
  }

  if (imageUrls.length > 0) {
    chunks.push(`${t("conversation.copySectionImages")}\n\n${imageUrls.map((u) => `- ${u}`).join("\n")}`);
  }

  return chunks.join("\n\n---\n\n");
}
