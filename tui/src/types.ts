export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export type TurnStatus =
  | "idle"
  | "planning"
  | "executing"
  | "complete"
  | "error"
  | "cancelled";

export type TranscriptRole = "user" | "assistant" | "system";

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HistoryMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly iteration: number | null;
  readonly timestampMs: number;
}

export interface ConversationEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly timestampMs: number;
  readonly iteration: number | null;
}

export interface PromptOption {
  readonly label: string;
  readonly value: string;
  readonly description: string;
}

export interface PendingAsk {
  requestId: string;
  question: string;
  title: string | null;
  allowFreeform: boolean;
  options: PromptOption[];
}

export interface TranscriptEntry {
  role: TranscriptRole;
  content: string;
  timestampMs: number;
  thinking: string;
}

export interface ToolCallState {
  rowId: string;
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  timestampMs: number;
  output: string;
  success: boolean | null;
  agentId: string | null;
}

export type PlanStepStatus = "pending" | "running" | "complete" | "error";

export interface PlanStepState {
  name: string;
  description: string;
  executionType: string;
  status: PlanStepStatus;
  agentId: string | null;
}

export type AgentLifecycleStatus =
  | "running"
  | "complete"
  | "error"
  | "skipped"
  | "replan_required";

export interface AgentStatus {
  agentId: string;
  name: string;
  description: string;
  status: AgentLifecycleStatus;
  timestampMs: number;
}

export interface ConversationViewState {
  conversationId: string | null;
  title: string;
  transcript: TranscriptEntry[];
  planSteps: PlanStepState[];
  toolCalls: ToolCallState[];
  agentStatuses: AgentStatus[];
  pendingAsk: PendingAsk | null;
  connectionStatus: ConnectionStatus;
  turnStatus: TurnStatus;
  orchestratorMode: string;
  assistantPhase: string;
  plannerAutoSelected: boolean;
  draftText: string;
  draftThinking: string[];
  draftTimestampMs: number;
}

export interface TuiConfig {
  readonly apiUrl: string;
  readonly apiKey: string | null;
  readonly proxySecret: string | null;
  readonly userGoogleId: string | null;
  readonly userEmail: string | null;
  readonly userName: string | null;
  readonly userPicture: string | null;
  readonly cookie: string | null;
  readonly conversationId: string | null;
  readonly usePlanner: boolean | null;
}

export const DEFAULT_TUI_CONFIG: TuiConfig = {
  apiUrl: "http://localhost:8000",
  apiKey: null,
  proxySecret: null,
  userGoogleId: null,
  userEmail: null,
  userName: null,
  userPicture: null,
  cookie: null,
  conversationId: null,
  usePlanner: null,
};

export function createEmptyViewState(
  title = "New conversation",
): ConversationViewState {
  return {
    conversationId: null,
    title,
    transcript: [],
    planSteps: [],
    toolCalls: [],
    agentStatuses: [],
    pendingAsk: null,
    connectionStatus: "disconnected",
    turnStatus: "idle",
    orchestratorMode: "agent",
    assistantPhase: "idle",
    plannerAutoSelected: false,
    draftText: "",
    draftThinking: [],
    draftTimestampMs: 0,
  };
}

export function toTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? Math.trunc(value * 1000) : Math.trunc(value);
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

export function normalizeMessageText(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function compactJson(value: unknown, limit = 120): string {
  if (
    value == null
    || value === ""
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value as Record<string, unknown>).length === 0)
  ) {
    return "";
  }

  const rendered = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();

  return rendered.length <= limit
    ? rendered
    : `${rendered.slice(0, Math.max(0, limit - 3))}...`;
}
