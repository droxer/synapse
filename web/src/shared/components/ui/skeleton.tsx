import { cn } from "@/shared/lib/utils";

interface SkeletonProps {
  readonly className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("rounded-md bg-secondary", className)}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--color-secondary) 0%, var(--color-border) 50%, var(--color-secondary) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 2s linear infinite",
      }}
    />
  );
}
