import { cn } from "@/shared/lib/utils";

interface SkeletonProps {
  readonly className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("skeleton-shimmer rounded-md", className)} />;
}
