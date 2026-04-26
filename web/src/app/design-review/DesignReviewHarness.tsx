"use client";

import { useEffect } from "react";
import { Bot, FileText, Settings2 } from "lucide-react";
import { ConversationWorkspace } from "@/features/conversation/components/ConversationWorkspace";
import { ArtifactFilesPanel } from "@/features/agent-computer";
import { Button } from "@/shared/components/ui/button";
import { Progress } from "@/shared/components/ui/progress";
import { cn } from "@/shared/lib/utils";
import type {
  AgentEvent,
  AgentStatus,
  ArtifactInfo,
  ChatMessage,
  PlanStep,
  ToolCallInfo,
} from "@/shared/types";

export type DesignReviewTheme = "light" | "dark";

const now = Date.now();

const messages: readonly ChatMessage[] = [
  {
    role: "user",
    content: "Review the frontend UI and produce an actionable design audit.",
    timestamp: now - 90_000,
    messageId: "fixture-user-1",
    source: "event",
  },
  {
    role: "assistant",
    content: "I checked the product surfaces, verified token usage, and found issues in skip-link navigation, compact touch targets, dim-token contrast, and progress timing.",
    timestamp: now - 60_000,
    messageId: "fixture-assistant-1",
    source: "event",
    thinkingEntries: [
      {
        content: "Audit focus: accessibility first, then interaction density, color contrast, motion timing, and authenticated visual coverage.",
        timestamp: now - 70_000,
        durationMs: 3200,
      },
    ],
  },
];

const planSteps: readonly PlanStep[] = [
  {
    name: "Inspect design system",
    description: "Confirm token, typography, motion, and control patterns.",
    executionType: "planner_owned",
    status: "complete",
  },
  {
    name: "Review authenticated surfaces",
    description: "Check chat, agent-computer, artifacts, skills, MCP, channels, and preferences.",
    executionType: "sequential_worker",
    status: "complete",
    agentId: "agent-design",
  },
  {
    name: "Verify responsive behavior",
    description: "Inspect 375, 768, 1024, and 1440px viewports.",
    executionType: "sequential_worker",
    status: "running",
    agentId: "agent-design",
  },
];

const events: readonly AgentEvent[] = [
  {
    type: "turn_start",
    timestamp: now - 95_000,
    iteration: 0,
    data: { message: "Review frontend UI", orchestrator_mode: "planner" },
  },
  {
    type: "plan_created",
    timestamp: now - 88_000,
    iteration: 0,
    data: {
      steps: planSteps.map((step) => ({
        name: step.name,
        description: step.description,
        execution_type: step.executionType,
      })),
    },
  },
  {
    type: "tool_call",
    timestamp: now - 75_000,
    iteration: 1,
    data: {
      tool_id: "tool-token-audit",
      tool_name: "shell",
      tool_input: { command: "npm run audit:design-tokens" },
    },
  },
  {
    type: "tool_result",
    timestamp: now - 70_000,
    iteration: 1,
    data: {
      tool_id: "tool-token-audit",
      output: "Design-token guardrail passed.",
      success: true,
    },
  },
  {
    type: "tool_call",
    timestamp: now - 55_000,
    iteration: 2,
    data: {
      tool_id: "tool-report",
      tool_name: "file_write",
      tool_input: { path: "docs/frontend-design-audit.md" },
    },
  },
  {
    type: "tool_result",
    timestamp: now - 50_000,
    iteration: 2,
    data: {
      tool_id: "tool-report",
      output: "Wrote frontend design audit.",
      success: true,
      artifact_ids: ["artifact-audit"],
    },
  },
];

const toolCalls: readonly ToolCallInfo[] = [
  {
    id: "tc-token-audit",
    toolUseId: "tool-token-audit",
    name: "shell",
    input: { command: "npm run audit:design-tokens" },
    output: "Design-token guardrail passed.",
    success: true,
    timestamp: now - 75_000,
    agentId: "agent-design",
  },
  {
    id: "tc-report",
    toolUseId: "tool-report",
    name: "file_write",
    input: { path: "docs/frontend-design-audit.md" },
    output: "Created frontend-design-audit.md",
    success: true,
    artifactIds: ["artifact-audit"],
    timestamp: now - 55_000,
    agentId: "agent-design",
  },
];

const agentStatuses: readonly AgentStatus[] = [
  {
    agentId: "agent-design",
    name: "Design Review",
    description: "Audits frontend UI quality and responsive behavior.",
    summary: "Found accessibility, touch target, contrast, and motion refinements.",
    status: "complete",
    timestamp: now - 45_000,
  },
];

const artifacts: readonly ArtifactInfo[] = [
  {
    id: "artifact-audit",
    name: "frontend-design-audit.md",
    contentType: "text/markdown",
    size: 8240,
    createdAt: new Date(now - 45_000).toISOString(),
    filePath: "docs/frontend-design-audit.md",
  },
  {
    id: "artifact-contrast",
    name: "contrast-check.json",
    contentType: "application/json",
    size: 1480,
    createdAt: new Date(now - 35_000).toISOString(),
    filePath: "reports/contrast-check.json",
  },
];

const swatches = [
  ["Primary", "bg-primary text-primary-foreground"],
  ["Secondary", "bg-secondary text-secondary-foreground"],
  ["Muted", "bg-muted text-muted-foreground"],
  ["Success", "bg-accent-emerald text-primary-foreground"],
  ["Warning", "bg-accent-amber text-primary-foreground"],
  ["Error", "bg-destructive text-primary-foreground"],
] as const;

export function DesignReviewHarness({ theme }: { readonly theme: DesignReviewTheme }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDarkClass = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;

    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;

    return () => {
      root.classList.toggle("dark", hadDarkClass);
      root.style.colorScheme = previousColorScheme;
    };
  }, [theme]);

  const themeLabel = theme === "dark" ? "Dark theme" : "Light theme";

  return (
    <main id="main" className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-mono text-muted-foreground-dim">Local visual fixture</p>
            <h1 className="text-2xl font-semibold tracking-tight">Frontend design review: {themeLabel}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Development-only route for reviewing authenticated Synapse UI states without OAuth.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm">
              <Bot className="h-4 w-4" />
              Primary action
            </Button>
            <Button type="button" variant="secondary" size="sm">
              <Settings2 className="h-4 w-4" />
              Secondary
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="h-[min(48rem,calc(100vh-9rem))] min-h-[34rem] overflow-hidden rounded-lg border border-border bg-background">
          <ConversationWorkspace
            conversationId="design-review-fixture"
            conversationTitle="Design review fixture"
            events={events}
            messages={messages}
            toolCalls={toolCalls}
            agentStatuses={agentStatuses}
            planSteps={planSteps}
            artifacts={artifacts}
            taskState="complete"
            currentThinkingEntries={[]}
            isStreaming={false}
            assistantPhase={{ phase: "idle" }}
            isConnected
            onSendMessage={() => undefined}
            onNavigateHome={() => undefined}
          />
        </div>

        <aside className="space-y-4">
          <div className="surface-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Token and state checks</h2>
            </div>
            <div className="space-y-3">
              <Progress value={72} indicatorClassName="bg-primary" aria-label="Fixture progress 72%" />
              <div className="grid grid-cols-2 gap-2">
                {swatches.map(([label, className]) => (
                  <div key={label} className={cn("rounded-md border border-border px-2 py-2 text-xs font-medium", className)}>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="h-[22rem] overflow-hidden rounded-lg border border-border">
            <ArtifactFilesPanel artifacts={artifacts} conversationId={null} />
          </div>
        </aside>
      </section>
    </main>
  );
}
