export type EventType =
  | "task_start"
  | "task_complete"
  | "task_error"
  | "turn_start"
  | "turn_complete"
  | "turn_cancelled"
  | "iteration_start"
  | "iteration_complete"
  | "llm_request"
  | "llm_response"
  | "text_delta"
  | "tool_call"
  | "tool_result"
  | "message_user"
  | "ask_user"
  | "user_response"
  | "agent_spawn"
  | "agent_complete"
  | "agent_handoff"
  | "thinking"
  | "sandbox_stdout"
  | "sandbox_stderr"
  | "code_result"
  | "artifact_created"
  | "conversation_title"
  | "skill_activated"
  | "plan_created";

export interface AgentEvent {
  readonly type: EventType;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly iteration: number | null;
}

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
  imageArtifactIds?: string[];
  readonly thinkingContent?: string;
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
  readonly id: string;
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
