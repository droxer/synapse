import {
  compactJson,
  createEmptyViewState,
} from "./types.ts";
import type {
  AgentLifecycleStatus,
  ConversationEvent,
  ConversationViewState,
  HistoryMessage,
  PlanStepState,
  PlanStepStatus,
  PromptOption,
  ToolCallState,
  TranscriptEntry,
} from "./types.ts";

const INLINE_THINK_PATTERNS = [
  /<redacted_thinking>([\s\S]*?)<\/redacted_thinking>/gi,
  /<redacted_thinking>([\s\S]*?)<\/think>/gi,
];

export function splitInlineThinking(text: string): {
  thinking: string;
  content: string;
} {
  const thinkingParts: string[] = [];
  let clean = text;

  for (const pattern of INLINE_THINK_PATTERNS) {
    clean = clean.replace(pattern, (_match, chunk: string) => {
      const trimmed = chunk.trim();
      if (trimmed) {
        thinkingParts.push(trimmed);
      }
      return "";
    });
  }

  return {
    thinking: thinkingParts.join("\n\n"),
    content: clean.trim(),
  };
}

export class ConversationStore {
  view: ConversationViewState = createEmptyViewState();

  private toolSequence = 0;
  private readonly respondedRequestIds = new Set<string>();

  reset(title = "New conversation"): void {
    this.view = createEmptyViewState(title);
    this.toolSequence = 0;
    this.respondedRequestIds.clear();
  }

  hydrate(
    conversationId: string,
    title: string,
    historyMessages: HistoryMessage[],
    historyEvents: ConversationEvent[],
  ): void {
    this.reset(title || "Untitled conversation");
    this.view.conversationId = conversationId;

    let lastMessageTs = 0;
    for (const message of historyMessages) {
      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }

      this.appendTranscript({
        role: message.role,
        content: message.content,
        timestampMs: message.timestampMs,
      });
      lastMessageTs = Math.max(lastMessageTs, message.timestampMs);
    }

    for (const event of historyEvents) {
      this.applyEvent(event, {
        allowTranscript: event.timestampMs > lastMessageTs,
      });
    }
  }

  setConnectionStatus(status: ConversationViewState["connectionStatus"]): void {
    this.view.connectionStatus = status;
  }

  isLiveTurnActive(): boolean {
    return (
      (this.view.turnStatus === "planning" || this.view.turnStatus === "executing")
      && this.view.pendingAsk == null
    );
  }

  applyEvent(
    event: ConversationEvent,
    options: { allowTranscript?: boolean } = {},
  ): void {
    const allowTranscript = options.allowTranscript ?? true;
    const data = event.data;

    switch (event.type) {
      case "conversation_title": {
        const title = getString(data.title) || getString(data.conversation_title);
        if (title) {
          this.view.title = title;
        }
        return;
      }

      case "planner_auto_selected":
        this.view.plannerAutoSelected = true;
        return;

      case "turn_start": {
        this.clearDraft();
        this.view.orchestratorMode = getString(data.orchestrator_mode) || "agent";
        this.view.turnStatus =
          this.view.orchestratorMode === "planner" ? "planning" : "executing";
        this.view.assistantPhase = "idle";

        if (allowTranscript) {
          let userText = getString(data.message);
          if (userText) {
            const attachments = Array.isArray(data.attachments)
              ? data.attachments
                  .filter(isRecord)
                  .map((item) => getString(item.name))
                  .filter((value): value is string => Boolean(value))
              : [];
            if (attachments.length > 0) {
              userText = `${userText}\n\nAttachments: ${attachments.join(", ")}`;
            }
            this.appendTranscript({
              role: "user",
              content: userText,
              timestampMs: event.timestampMs,
            });
          }
        }
        return;
      }

      case "thinking": {
        if (getString(data.agent_id)) {
          return;
        }
        const content =
          getString(data.thinking)
          || getString(data.text)
          || getString(data.content);
        if (content) {
          this.view.draftThinking.push(content);
          this.view.assistantPhase = "thinking";
        }
        return;
      }

      case "text_delta": {
        if (getString(data.agent_id)) {
          return;
        }
        const delta = getString(data.delta);
        if (delta) {
          if (!this.view.draftTimestampMs) {
            this.view.draftTimestampMs = event.timestampMs;
          }
          this.view.draftText += delta;
          this.view.turnStatus = "executing";
          this.view.assistantPhase = "writing";
        }
        return;
      }

      case "llm_response": {
        const responseText =
          getString(data.text)
          || getString(data.content)
          || getString(data.message)
          || "";
        const { thinking, content } = splitInlineThinking(responseText);
        if (thinking) {
          this.view.draftThinking.push(thinking);
        }
        if (allowTranscript && content && !this.view.draftText) {
          this.appendAssistantMessage(content, event.timestampMs);
        }
        this.view.assistantPhase = "idle";
        return;
      }

      case "message_user": {
        if (allowTranscript) {
          const content = getString(data.message) || getString(data.content);
          if (content) {
            this.appendAssistantMessage(content, event.timestampMs);
          }
        }
        this.view.assistantPhase = "idle";
        return;
      }

      case "tool_call":
        this.registerToolCall(event);
        this.view.turnStatus = "executing";
        return;

      case "tool_result":
        this.registerToolResult(event);
        return;

      case "sandbox_stdout":
        this.appendStreamOutput(getString(data.text) || "");
        return;

      case "sandbox_stderr": {
        const stderr = getString(data.text) || "";
        if (stderr) {
          this.appendStreamOutput(`stderr: ${stderr}`);
        }
        return;
      }

      case "code_result":
        this.registerCodeResult(event);
        return;

      case "plan_created": {
        if (!Array.isArray(data.steps)) {
          return;
        }
        const parsed: PlanStepState[] = [];
        data.steps.forEach((step, index) => {
          if (!isRecord(step)) {
            return;
          }
          parsed.push({
            name: getString(step.name) || `Step ${index + 1}`,
            description: getString(step.description) || "",
            executionType: getString(step.execution_type) || "planner_owned",
            status: "pending",
            agentId: null,
          });
        });
        if (parsed.length > 0) {
          this.view.planSteps = parsed;
          this.view.turnStatus = "planning";
        }
        return;
      }

      case "agent_spawn":
        this.upsertAgent({
          agentId: getString(data.agent_id) || getString(data.id) || "",
          name: getString(data.name) || "Worker",
          description: getString(data.description) || getString(data.task) || "",
          status: "running",
          timestampMs: event.timestampMs,
        });
        this.markFirstPendingStepRunning(
          getString(data.agent_id) || getString(data.id) || "",
        );
        this.view.turnStatus = "planning";
        return;

      case "agent_start":
        this.updateAgentStatus(
          getString(data.agent_id) || getString(data.id) || "",
          "running",
          event.timestampMs,
        );
        return;

      case "agent_complete": {
        const status = getString(data.terminal_state) || "";
        let finalStatus: AgentLifecycleStatus = "complete";
        let stepStatus: PlanStepStatus = "complete";
        if (status === "skipped") {
          finalStatus = "skipped";
          stepStatus = "complete";
        } else if (status === "replan_required") {
          finalStatus = "replan_required";
          stepStatus = "error";
        } else if (data.error) {
          finalStatus = "error";
          stepStatus = "error";
        }
        const agentId = getString(data.agent_id) || getString(data.id) || "";
        this.updateAgentStatus(agentId, finalStatus, event.timestampMs);
        this.markStepForAgent(agentId, stepStatus);
        return;
      }

      case "agent_skipped": {
        const agentId = getString(data.agent_id) || getString(data.id) || "";
        this.updateAgentStatus(agentId, "skipped", event.timestampMs);
        this.markStepForAgent(agentId, "complete");
        return;
      }

      case "agent_replan_required": {
        const agentId = getString(data.agent_id) || getString(data.id) || "";
        this.updateAgentStatus(agentId, "replan_required", event.timestampMs);
        this.markStepForAgent(agentId, "error");
        return;
      }

      case "ask_user": {
        const requestId = getString(data.request_id) || "";
        if (!requestId || this.respondedRequestIds.has(requestId)) {
          return;
        }

        const metadata = isRecord(data.prompt_metadata) ? data.prompt_metadata : null;
        this.view.pendingAsk = {
          requestId,
          title: getString(data.title) || null,
          question: getString(data.message) || getString(data.question) || "",
          options: this.parsePromptOptions(data.options),
          allowFreeform:
            typeof metadata?.allow_freeform === "boolean"
              ? metadata.allow_freeform
              : true,
        };
        return;
      }

      case "user_response": {
        const requestId = getString(data.request_id) || "";
        if (requestId) {
          this.respondedRequestIds.add(requestId);
        }
        if (this.view.pendingAsk?.requestId === requestId) {
          this.view.pendingAsk = null;
        }
        return;
      }

      case "turn_cancelled":
        this.finalizeDraft({ timestampMs: event.timestampMs });
        this.appendTranscript({
          role: "system",
          content: "Turn cancelled.",
          timestampMs: event.timestampMs,
        });
        this.completePendingTools(false);
        this.view.turnStatus = "cancelled";
        this.view.assistantPhase = "idle";
        return;

      case "turn_complete":
        this.finalizeDraft({
          resultText: getString(data.result) || "",
          timestampMs: event.timestampMs,
        });
        this.completePendingTools(true, true);
        this.view.turnStatus = "complete";
        this.view.assistantPhase = "idle";
        return;

      case "task_complete": {
        const result = getString(data.summary) || getString(data.result) || "";
        this.finalizeDraft({
          resultText: result,
          timestampMs: event.timestampMs,
        });
        this.completePendingTools(true, true);
        for (const step of this.view.planSteps) {
          if (step.status === "pending" || step.status === "running") {
            step.status = "complete";
          }
        }
        this.view.turnStatus = "complete";
        this.view.assistantPhase = "idle";
        return;
      }

      case "task_error": {
        this.finalizeDraft({ timestampMs: event.timestampMs });
        const errorText = getString(data.error) || "An error occurred";
        this.appendTranscript({
          role: "system",
          content: `Error: ${errorText}`,
          timestampMs: event.timestampMs,
        });
        this.completePendingTools(false);
        for (const step of this.view.planSteps) {
          if (step.status === "running") {
            step.status = "error";
          }
        }
        this.view.turnStatus = "error";
        this.view.assistantPhase = "idle";
        return;
      }

      default:
        return;
    }
  }

  renderToolInput(tool: ToolCallState): string {
    return compactJson(tool.input);
  }

  private appendAssistantMessage(content: string, timestampMs: number): void {
    const thinking = this.view.draftThinking.filter(Boolean).join("\n\n").trim();
    this.appendTranscript({
      role: "assistant",
      content,
      timestampMs,
      thinking,
    });
    this.clearDraft();
  }

  private appendTranscript(entry: {
    role: TranscriptEntry["role"];
    content: string;
    timestampMs: number;
    thinking?: string;
  }): void {
    const normalized = entry.content.trim();
    if (!normalized) {
      return;
    }

    const last = this.view.transcript.at(-1);
    if (last && last.role === entry.role && last.content === normalized) {
      if (entry.role === "assistant" && entry.thinking && !last.thinking) {
        last.thinking = entry.thinking;
      }
      return;
    }

    this.view.transcript.push({
      role: entry.role,
      content: normalized,
      timestampMs: entry.timestampMs,
      thinking: entry.thinking ?? "",
    });
  }

  private clearDraft(): void {
    this.view.draftText = "";
    this.view.draftThinking = [];
    this.view.draftTimestampMs = 0;
  }

  private finalizeDraft(options: {
    resultText?: string;
    timestampMs?: number;
  }): void {
    const content = this.view.draftText.trim() || (options.resultText ?? "").trim();
    if (content) {
      this.appendAssistantMessage(
        content,
        options.timestampMs || this.view.draftTimestampMs,
      );
      return;
    }
    this.clearDraft();
  }

  private registerToolCall(event: ConversationEvent): void {
    const toolUseId =
      getString(event.data.tool_id) || getString(event.data.id) || "";
    this.toolSequence += 1;
    this.view.toolCalls.push({
      rowId: `tool-${this.toolSequence}`,
      toolUseId: toolUseId || `tool-${this.toolSequence}`,
      name:
        getString(event.data.tool_name)
        || getString(event.data.name)
        || "tool",
      input: this.coerceToolInput(event.data),
      timestampMs: event.timestampMs,
      output: "",
      success: null,
      agentId: getString(event.data.agent_id) || null,
    });
    this.view.assistantPhase = `using ${this.view.toolCalls.at(-1)?.name ?? "tool"}`;
  }

  private registerToolResult(event: ConversationEvent): void {
    const toolUseId =
      getString(event.data.tool_id) || getString(event.data.id) || "";
    const tool = this.findTool(toolUseId);
    if (!tool) {
      return;
    }

    tool.output =
      getString(event.data.output)
      || getString(event.data.result)
      || "";
    tool.success =
      typeof event.data.success === "boolean" ? event.data.success : true;
    tool.agentId = getString(event.data.agent_id) || tool.agentId;
    this.view.assistantPhase = "idle";
  }

  private registerCodeResult(event: ConversationEvent): void {
    const toolUseId = getString(event.data.tool_id) || "";
    const tool = toolUseId ? this.findTool(toolUseId) : this.findLastPendingTool();
    if (!tool) {
      return;
    }
    tool.output =
      getString(event.data.output)
      || getString(event.data.result)
      || "";
    tool.success = event.data.success !== false;
    this.view.assistantPhase = "idle";
  }

  private appendStreamOutput(text: string): void {
    if (!text) {
      return;
    }

    const tool = this.findLastPendingTool();
    if (!tool) {
      return;
    }

    tool.output = `${tool.output}${text}`;
  }

  private coerceToolInput(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const key of ["tool_input", "input", "arguments"]) {
      if (isRecord(data[key])) {
        return data[key];
      }
    }
    return {};
  }

  private findTool(toolUseId: string): ToolCallState | null {
    if (toolUseId) {
      for (let index = this.view.toolCalls.length - 1; index >= 0; index -= 1) {
        const tool = this.view.toolCalls[index];
        if (tool && tool.toolUseId === toolUseId) {
          return tool;
        }
      }
    }
    return this.findLastPendingTool();
  }

  private findLastPendingTool(): ToolCallState | null {
    for (let index = this.view.toolCalls.length - 1; index >= 0; index -= 1) {
      const tool = this.view.toolCalls[index];
      if (tool && tool.success == null) {
        return tool;
      }
    }
    return null;
  }

  private parsePromptOptions(rawOptions: unknown): PromptOption[] {
    if (!Array.isArray(rawOptions)) {
      return [];
    }

    const options: PromptOption[] = [];
    for (const option of rawOptions) {
      if (!isRecord(option)) {
        continue;
      }

      const label = getString(option.label);
      if (!label) {
        continue;
      }

      options.push({
        label,
        value: getString(option.value) || label,
        description: getString(option.description) || "",
      });
    }
    return options;
  }

  private upsertAgent(agent: {
    agentId: string;
    name: string;
    description: string;
    status: AgentLifecycleStatus;
    timestampMs: number;
  }): void {
    for (const existing of this.view.agentStatuses) {
      if (existing.agentId === agent.agentId && agent.agentId) {
        existing.name = agent.name || existing.name;
        existing.description = agent.description || existing.description;
        existing.status = agent.status;
        existing.timestampMs = agent.timestampMs;
        return;
      }
    }

    this.view.agentStatuses.push({
      agentId: agent.agentId || `agent-${this.view.agentStatuses.length + 1}`,
      name: agent.name || "Worker",
      description: agent.description,
      status: agent.status,
      timestampMs: agent.timestampMs,
    });
  }

  private updateAgentStatus(
    agentId: string,
    status: AgentLifecycleStatus,
    timestampMs: number,
  ): void {
    if (!agentId) {
      return;
    }

    for (const agent of this.view.agentStatuses) {
      if (agent.agentId === agentId) {
        agent.status = status;
        agent.timestampMs = timestampMs;
        return;
      }
    }
  }

  private markFirstPendingStepRunning(agentId: string): void {
    for (const step of this.view.planSteps) {
      if (step.status === "pending" && step.executionType !== "planner_owned") {
        step.status = "running";
        step.agentId = agentId || step.agentId;
        return;
      }
    }
  }

  private markStepForAgent(agentId: string, status: PlanStepStatus): void {
    for (const step of this.view.planSteps) {
      if (step.agentId === agentId) {
        step.status = status;
        return;
      }
    }

    for (const step of this.view.planSteps) {
      if (step.status === "running" && step.executionType !== "planner_owned") {
        step.status = status;
        step.agentId = agentId || step.agentId;
        return;
      }
    }
  }

  private completePendingTools(success: boolean, leaveUnknown = false): void {
    for (const tool of this.view.toolCalls) {
      if (tool.success == null && !leaveUnknown) {
        tool.success = success;
      }
    }
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
