"use client";

import { MCPPage } from "@/features/mcp/components/MCPPage";
import { ErrorBoundary } from "@/shared/components";

export default function Page() {
  return (
    <ErrorBoundary>
      <MCPPage />
    </ErrorBoundary>
  );
}
