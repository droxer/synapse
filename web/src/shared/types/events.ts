export const EVENT_TYPES = [
  "task_start",
  "task_complete",
  "task_error",
  "turn_start",
  "turn_complete",
  "turn_cancelled",
  "iteration_start",
  "iteration_complete",
  "llm_request",
  "llm_response",
  "text_delta",
  "tool_call",
  "tool_result",
  "message_user",
  "ask_user",
  "user_response",
  "agent_spawn",
  "agent_complete",
  "agent_handoff",
  "thinking",
  "sandbox_stdout",
  "sandbox_stderr",
  "code_result",
  "artifact_created",
  "conversation_title",
  "skill_activated",
  "plan_created",
  "loop_guard_nudge",
  "planner_auto_selected",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

type GenericEventData = Record<string, unknown>;

export interface TurnStartEventData extends GenericEventData {
  readonly message?: string;
  readonly orchestrator_mode?: "agent" | "planner";
}

export interface ThinkingEventData extends GenericEventData {
  readonly thinking?: string;
  readonly text?: string;
  readonly content?: string;
  readonly duration_ms?: number;
}

export interface TextDeltaEventData extends GenericEventData {
  readonly delta?: string;
}

export interface LLMResponseEventData extends GenericEventData {
  readonly text?: string;
  readonly content?: string;
  readonly message?: string;
}

export interface ToolCallEventData extends GenericEventData {
  /** Canonical fields emitted by the backend. */
  readonly tool_id?: string;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  readonly agent_id?: string;
}

export interface ToolResultEventData extends GenericEventData {
  readonly tool_id?: string;
  readonly output?: unknown;
  readonly result?: unknown;
  readonly success?: boolean;
  readonly content_type?: string;
  readonly artifact_ids?: string[];
  readonly agent_id?: string;
  readonly steps?: number;
  readonly is_done?: boolean;
  readonly max_steps?: number;
  readonly url?: string;
  readonly task?: string;
  readonly action?: string;
  readonly x?: number;
  readonly y?: number;
  readonly text?: string;
  readonly end_x?: number;
  readonly end_y?: number;
  readonly amount?: number;
}

export interface ArtifactCreatedEventData extends GenericEventData {
  readonly artifact_id?: string;
  readonly name?: string;
  readonly content_type?: string;
  readonly size?: number;
}

export interface AgentSpawnEventData extends GenericEventData {
  readonly agent_id?: string;
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly task?: string;
}

export interface AgentCompleteEventData extends GenericEventData {
  readonly agent_id?: string;
  readonly id?: string;
  readonly error?: unknown;
}

export interface PlanCreatedEventData extends GenericEventData {
  readonly steps?: Array<{ readonly name?: string; readonly description?: string }>;
}

export interface SkillActivatedEventData extends GenericEventData {
  readonly name?: string;
  readonly source?: "explicit" | "auto" | "mid_turn";
}

export interface LoopGuardNudgeEventData extends GenericEventData {
  readonly iteration?: number;
  readonly repeated_signature?: string;
}

export type AgentEventDataByType = {
  task_start: GenericEventData;
  task_complete: GenericEventData;
  task_error: GenericEventData;
  turn_start: TurnStartEventData;
  turn_complete: GenericEventData;
  turn_cancelled: GenericEventData;
  iteration_start: GenericEventData;
  iteration_complete: GenericEventData;
  llm_request: GenericEventData;
  llm_response: LLMResponseEventData;
  text_delta: TextDeltaEventData;
  tool_call: ToolCallEventData;
  tool_result: ToolResultEventData;
  message_user: GenericEventData;
  ask_user: GenericEventData;
  user_response: GenericEventData;
  agent_spawn: AgentSpawnEventData;
  agent_complete: AgentCompleteEventData;
  agent_handoff: GenericEventData;
  thinking: ThinkingEventData;
  sandbox_stdout: GenericEventData;
  sandbox_stderr: GenericEventData;
  code_result: GenericEventData;
  artifact_created: ArtifactCreatedEventData;
  conversation_title: GenericEventData;
  skill_activated: SkillActivatedEventData;
  plan_created: PlanCreatedEventData;
  loop_guard_nudge: LoopGuardNudgeEventData;
  planner_auto_selected: GenericEventData;
};

export type AgentEvent = {
  readonly [K in EventType]: {
    readonly type: K;
    readonly data: AgentEventDataByType[K];
    readonly timestamp: number;
    readonly iteration: number | null;
  };
}[EventType];

export type TaskState = "idle" | "planning" | "executing" | "complete" | "error";

export interface AttachedFile {
  file: File;
  id: string;
  previewUrl?: string;
}

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  readonly attachments?: Array<{ readonly name: string; readonly size: number; readonly type: string }>;
  readonly imageArtifactIds?: readonly string[];
  readonly thinkingContent?: string;
  readonly thinkingEntries?: readonly ThinkingEntry[];
  /** Stable key for merging optimistic, history, and event-derived rows. */
  readonly messageId?: string;
  readonly source?: "history" | "event" | "optimistic";
  readonly turnId?: string;
}

export interface ThinkingEntry {
  readonly content: string;
  readonly timestamp: number;
  readonly durationMs: number;
}

export interface BrowserMetadata {
  readonly steps?: number;
  readonly isDone?: boolean;
  readonly maxSteps?: number;
  readonly url?: string;
  readonly task?: string;
}

export interface ComputerUseMetadata {
  readonly action?: string;
  readonly x?: number;
  readonly y?: number;
  readonly text?: string;
  readonly endX?: number;
  readonly endY?: number;
  readonly amount?: number;
}

export interface ToolCallInfo {
  /** Stable unique id for React keys and UI (monotonic per conversation timeline). */
  readonly id: string;
  /** Provider tool_use id from events; may repeat across turns, so do not use as React key. */
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly output?: string;
  readonly success?: boolean;
  readonly contentType?: string;
  readonly artifactIds?: string[];
  readonly browserMetadata?: BrowserMetadata;
  readonly computerUseMetadata?: ComputerUseMetadata;
  readonly timestamp: number;
  readonly agentId?: string;
  readonly thinkingText?: string;
}

export interface ArtifactInfo {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly filePath?: string;
}

export interface PlanStep {
  readonly name: string;
  readonly description: string;
  readonly status: "pending" | "running" | "complete" | "error";
  readonly agentId?: string;
}

export interface AgentStatus {
  readonly agentId: string;
  readonly name: string;
  readonly description: string;
  readonly status: "running" | "complete" | "error";
  readonly timestamp: number;
}

export type AssistantPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "thinking" }
  | { readonly phase: "writing" }
  | { readonly phase: "using_tool"; readonly toolName: string };
