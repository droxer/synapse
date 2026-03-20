/** Tools that should be hidden from the activity view (communication-only). */
export const HIDDEN_ACTIVITY_TOOLS = new Set([
  "user_message",
  "plan_create",
]);

/** Tools whose results are never considered "artifacts" for panel auto-open. */
export const NON_ARTIFACT_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "user_ask",
  "user_message",
  "memory_store",
  "memory_search",
  "task_complete",
  "plan_create",
]);

/** Tools whose output should be rendered as code. */
export const CODE_TOOLS = new Set([
  "code_run",
  "code_interpret",
  "shell_exec",
  "file_read",
]);

/** Map raw tool names to human-friendly display names. */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // Local tools
  web_search: "Web Search",
  web_fetch: "Web Fetch",
  user_ask: "Ask User",
  user_message: "Message User",
  memory_store: "Memory Store",
  memory_search: "Memory Search",
  memory_list: "Memory List",
  image_generate: "Image Generate",
  task_complete: "Task Complete",
  // Sandbox: code & shell
  code_run: "Code Run",
  code_interpret: "Code Interpret",
  shell_exec: "Shell Execute",
  package_install: "Package Install",
  // Sandbox: files
  file_read: "File Read",
  file_write: "File Write",
  file_edit: "File Edit",
  file_list: "File List",
  file_glob: "File Glob",
  file_search: "File Search",
  // Sandbox: browser
  browser_use: "Browser Use",
  // Sandbox: documents
  document_read: "Document Read",
  // Sandbox: database
  database_create: "Database Create",
  database_query: "Database Query",
  database_schema: "Database Schema",
  // Sandbox: computer use
  computer_screenshot: "Screenshot",
  computer_action: "Computer Use",
  // Sandbox: preview
  preview_start: "Preview Start",
  preview_stop: "Preview Stop",
  // Meta: agents
  plan_create: "Create Plan",
  agent_spawn: "Spawn Agent",
  agent_send: "Send Message",
  agent_receive: "Receive Message",
  agent_wait: "Wait for Agents",
  // Skills
  activate_skill: "Load Skill",
  load_skill: "Load Skill",
};

type TFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Return a normalized, i18n-aware display name for a tool.
 * Looks up `tools.name.{rawName}` via `t()`; falls back to `normalizeToolName()`.
 */
export function normalizeToolNameI18n(rawName: string, t: TFn): string {
  // MCP tools don't have i18n keys — delegate to normalizeToolName
  if (rawName.includes("__")) return normalizeToolName(rawName);
  const i18nKey = `tools.name.${rawName}`;
  const translated = t(i18nKey);
  if (translated === i18nKey) return normalizeToolName(rawName);
  return translated;
}

/**
 * Return a normalized, human-friendly display name for a tool.
 * Falls back to title-casing the snake_case name.
 */
export function normalizeToolName(rawName: string): string {
  // MCP tools use server__toolname convention
  if (rawName.includes("__")) {
    const [serverName, ...rest] = rawName.split("__");
    const toolPart = rest.join("__");
    const formattedTool = toolPart
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return `${formattedTool} (${serverName})`;
  }
  const mapped = TOOL_DISPLAY_NAMES[rawName];
  if (mapped) return mapped;
  return rawName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Normalize a spawned agent's display name to Title Case.
 * Handles snake_case, lowercase, and already-formatted names.
 */
export function normalizeAgentName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Agent";
  return trimmed
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type ToolCategory = "code" | "file" | "search" | "memory" | "browser" | "computer" | "preview" | "mcp" | "agent" | "database" | "default";

const SEARCH_TOOLS = new Set(["web_search", "web_fetch"]);
const MEMORY_TOOLS = new Set(["memory_store", "memory_search", "memory_list"]);
const PREVIEW_TOOLS = new Set(["preview_start", "preview_stop"]);
const BROWSER_TOOLS = new Set(["browser_use"]);
const COMPUTER_TOOLS = new Set(["computer_action", "computer_screenshot"]);
const FILE_TOOLS = new Set(["file_read", "file_write"]);
export const AGENT_TOOLS = new Set(["agent_spawn", "agent_wait", "agent_send", "agent_receive"]);
const DATABASE_TOOLS = new Set(["database_query", "database_create", "database_schema"]);

export function getToolCategory(toolName: string): ToolCategory {
  if (toolName.includes("__")) return "mcp";
  if (CODE_TOOLS.has(toolName) && !FILE_TOOLS.has(toolName)) return "code";
  if (FILE_TOOLS.has(toolName)) return "file";
  if (SEARCH_TOOLS.has(toolName)) return "search";
  if (MEMORY_TOOLS.has(toolName)) return "memory";
  if (BROWSER_TOOLS.has(toolName)) return "browser";
  if (COMPUTER_TOOLS.has(toolName)) return "computer";
  if (PREVIEW_TOOLS.has(toolName)) return "preview";
  if (AGENT_TOOLS.has(toolName)) return "agent";
  if (DATABASE_TOOLS.has(toolName)) return "database";
  return "default";
}
