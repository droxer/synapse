import type { ChatMessage, PlanStep, TaskState, ThinkingEntry } from "@/shared/types";
import type { Locale } from "@/i18n/types";

export interface MessageRowMemoProps {
  readonly msg: ChatMessage;
  readonly isLastAssistant: boolean;
  readonly isStreamingThis: boolean;
  readonly isThinkingThis: boolean;
  readonly messageWidthClass: string;
  readonly embeddedPlanSteps: readonly PlanStep[];
  readonly index: number;
  readonly conversationId: string | null;
  readonly taskState: TaskState;
  readonly locale: Locale;
  readonly suppressEmbeddedThinking?: boolean;
  /** When set, these replace embedded msg thinking for display (e.g. live stream above body). */
  readonly streamThinkingEntries?: readonly ThinkingEntry[];
  readonly onRetry?: () => void;
}

function arePlanStepsEqual(
  a: readonly PlanStep[],
  b: readonly PlanStep[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]?.name !== b[i]?.name ||
      a[i]?.status !== b[i]?.status ||
      a[i]?.description !== b[i]?.description ||
      a[i]?.executionType !== b[i]?.executionType ||
      a[i]?.agentId !== b[i]?.agentId
    ) {
      return false;
    }
  }
  return true;
}

export function areMessageRowsEqual(
  prev: MessageRowMemoProps,
  next: MessageRowMemoProps,
): boolean {
  const prevMsg = prev.msg;
  const nextMsg = next.msg;
  const sameThinkingEntries =
    (prevMsg.thinkingEntries?.length ?? 0) === (nextMsg.thinkingEntries?.length ?? 0) &&
    (prevMsg.thinkingEntries ?? []).every((entry, index) => {
      const nextEntry = nextMsg.thinkingEntries?.[index];
      return (
        entry.content === nextEntry?.content &&
        entry.timestamp === nextEntry?.timestamp &&
        entry.durationMs === nextEntry?.durationMs
      );
    });
  const sameStreamThinkingEntries = (() => {
    const a = prev.streamThinkingEntries;
    const b = next.streamThinkingEntries;
    if (a === b) return true;
    if (!a?.length && !b?.length) return true;
    if (!a || !b || a.length !== b.length) return false;
    return a.every((entry, index) => {
      const o = b[index];
      return (
        entry.content === o?.content &&
        entry.timestamp === o?.timestamp &&
        entry.durationMs === o?.durationMs
      );
    });
  })();
  const sameImageIds =
    (prevMsg.imageArtifactIds?.length ?? 0) === (nextMsg.imageArtifactIds?.length ?? 0) &&
    (prevMsg.imageArtifactIds ?? []).every((artifactId, index) => artifactId === nextMsg.imageArtifactIds?.[index]);

  const sameAttachments =
    (prevMsg.attachments?.length ?? 0) === (nextMsg.attachments?.length ?? 0) &&
    (prevMsg.attachments ?? []).every((att, index) => {
      const nextAtt = nextMsg.attachments?.[index];
      return (
        att.name === nextAtt?.name &&
        att.size === nextAtt?.size &&
        att.type === nextAtt?.type
      );
    });

  return (
    prevMsg.messageId === nextMsg.messageId &&
    prevMsg.role === nextMsg.role &&
    prevMsg.content === nextMsg.content &&
    prevMsg.timestamp === nextMsg.timestamp &&
    prevMsg.thinkingContent === nextMsg.thinkingContent &&
    sameThinkingEntries &&
    sameImageIds &&
    sameAttachments &&
    prev.isLastAssistant === next.isLastAssistant &&
    prev.isStreamingThis === next.isStreamingThis &&
    prev.isThinkingThis === next.isThinkingThis &&
    prev.suppressEmbeddedThinking === next.suppressEmbeddedThinking &&
    sameStreamThinkingEntries &&
    prev.messageWidthClass === next.messageWidthClass &&
    arePlanStepsEqual(prev.embeddedPlanSteps, next.embeddedPlanSteps) &&
    prev.index === next.index &&
    prev.conversationId === next.conversationId &&
    prev.taskState === next.taskState &&
    prev.locale === next.locale &&
    prev.onRetry === next.onRetry
  );
}
