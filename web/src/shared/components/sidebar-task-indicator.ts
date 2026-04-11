export type SidebarTaskIndicatorVariant = "running" | "active" | "idle";

interface SidebarTaskIndicatorInput {
  readonly isRunning: boolean;
  readonly isActive: boolean;
}

export function getSidebarTaskIndicatorVariant({
  isRunning,
  isActive,
}: SidebarTaskIndicatorInput): SidebarTaskIndicatorVariant {
  if (isRunning) {
    return "running";
  }
  if (isActive) {
    return "active";
  }
  return "idle";
}
