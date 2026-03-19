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
  | "skill_activated";

export interface AgentEvent {
  type: EventType;
  data: Record<string, unknown>;
  timestamp: number;
  iteration: number | null;
}

export type TaskState = "idle" | "planning" | "executing" | "complete" | "error";

export interface AttachedFile {
  file: File;
  id: string;
  previewUrl?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  attachments?: Array<{ name: string; size: number; type: string }>;
  imageArtifactIds?: string[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  success?: boolean;
  contentType?: string;
  artifactIds?: string[];
  timestamp: number;
  agentId?: string;
}

export interface ArtifactInfo {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
}

export interface AgentStatus {
  agentId: string;
  description: string;
  status: "running" | "complete" | "error";
}

export type AssistantPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "thinking" }
  | { readonly phase: "writing" }
  | { readonly phase: "using_tool"; readonly toolName: string };
