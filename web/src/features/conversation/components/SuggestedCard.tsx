"use client";

import { Button } from "@/shared/components/ui/button";

interface SuggestedCardProps {
  readonly text: string;
}

export function SuggestedCard({ text }: SuggestedCardProps) {
  return (
    <Button
      variant="outline"
      className="h-auto rounded-lg border-border p-3 text-left text-sm text-muted-foreground transition-all hover:border-border-active hover:text-foreground hover:shadow-sm"
    >
      {text}
    </Button>
  );
}
