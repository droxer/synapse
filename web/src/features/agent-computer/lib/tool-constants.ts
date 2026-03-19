/** Tools that should be hidden from the activity view (communication-only). */
export const HIDDEN_ACTIVITY_TOOLS = new Set([
  "user_message",
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
  browser_navigate: "Browser Navigate",
  browser_click: "Browser Click",
  browser_type: "Browser Type",
  browser_scroll: "Browser Scroll",
  browser_extract: "Browser Extract",
  // Sandbox: documents
  document_read: "Document Read",
  // Sandbox: database
  database_create: "Database Create",
  database_query: "Database Query",
  database_schema: "Database Schema",
  // Sandbox: computer use
  computer_screenshot: "Screenshot",
  computer_action: "Computer Action",
  // Sandbox: preview
  preview_start: "Preview Start",
  preview_stop: "Preview Stop",
  // Meta: agents
  agent_spawn: "Spawn Agent",
  agent_send: "Send Message",
  agent_receive: "Receive Message",
  agent_wait: "Wait for Agents",
  // Skills
  activate_skill: "Load Skill",
  load_skill: "Load Skill",
};

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

export type ToolCategory = "code" | "file" | "search" | "memory" | "browser" | "preview" | "mcp" | "default";

const SEARCH_TOOLS = new Set(["web_search", "web_fetch"]);
const MEMORY_TOOLS = new Set(["memory_store", "memory_search", "memory_list"]);
const PREVIEW_TOOLS = new Set(["preview_start", "preview_stop"]);
const BROWSER_TOOLS = new Set(["browser_navigate"]);
const FILE_TOOLS = new Set(["file_read", "file_write"]);

export function getToolCategory(toolName: string): ToolCategory {
  if (toolName.includes("__")) return "mcp";
  if (CODE_TOOLS.has(toolName) && !FILE_TOOLS.has(toolName)) return "code";
  if (FILE_TOOLS.has(toolName)) return "file";
  if (SEARCH_TOOLS.has(toolName)) return "search";
  if (MEMORY_TOOLS.has(toolName)) return "memory";
  if (BROWSER_TOOLS.has(toolName)) return "browser";
  if (PREVIEW_TOOLS.has(toolName)) return "preview";
  return "default";
}
