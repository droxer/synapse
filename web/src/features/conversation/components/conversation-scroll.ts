interface ScrollDecisionInput {
  readonly previousActivityCount: number;
  readonly nextActivityCount: number;
  readonly distanceFromBottom: number;
  readonly thresholdPx?: number;
}

export function shouldAutoScrollToBottom({
  previousActivityCount,
  nextActivityCount,
  distanceFromBottom,
  thresholdPx = 120,
}: ScrollDecisionInput): boolean {
  const firstPopulate = previousActivityCount === 0 && nextActivityCount > 0;
  const hasNewActivity = nextActivityCount > previousActivityCount;
  if (!firstPopulate && !hasNewActivity) return false;
  if (firstPopulate) return true;
  return distanceFromBottom < thresholdPx;
}
