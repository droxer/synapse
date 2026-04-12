import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Ban,
  BookMarked,
  BookOpen,
  Braces,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Code,
  Compass,
  Cpu,
  Database,
  Download,
  Eye,
  FilePenLine,
  FileSearch,
  FileText,
  FlaskConical,
  FolderSearch,
  FolderTree,
  GitBranch,
  GitFork,
  Globe,
  GraduationCap,
  Hammer,
  HelpCircle,
  Hourglass,
  Image,
  Inbox,
  KeyRound,
  Keyboard,
  Layers,
  Library,
  Lightbulb,
  LineChart,
  List,
  ListChecks,
  MapPin,
  MessageSquare,
  MousePointer2,
  MousePointerClick,
  Network,
  Package,
  PenTool,
  Play,
  Plug,
  Puzzle,
  Rocket,
  ScrollText,
  Search,
  Send,
  Shield,
  Sparkles,
  Square,
  SquareTerminal,
  Table2,
  Target,
  Telescope,
  Terminal,
  Wand2,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { getToolCategory, type ToolCategory } from "@/features/agent-computer/lib/tool-constants";

/** Per-tool glyph for activity UIs (progress card, computer panel). */
const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Search,
  web_fetch: Download,
  user_ask: HelpCircle,
  user_message: MessageSquare,
  message_user: MessageSquare,
  memory_store: Archive,
  memory_search: Library,
  memory_list: List,
  image_generate: Image,
  task_complete: CheckCircle2,
  code_run: Play,
  code_interpret: Braces,
  shell_exec: Terminal,
  shell_view: Eye,
  shell_wait: Hourglass,
  shell_write: PenTool,
  shell_kill: Ban,
  package_install: Package,
  file_read: FileText,
  file_write: FilePenLine,
  file_edit: FilePenLine,
  file_list: FolderTree,
  file_glob: FolderSearch,
  file_search: FileSearch,
  browser_use: Compass,
  browser_navigate: MapPin,
  browser_view: Eye,
  browser_click: MousePointerClick,
  browser_input: Keyboard,
  browser_select: ListChecks,
  browser_scroll_up: ChevronUp,
  browser_scroll_down: ChevronDown,
  browser_press_key: KeyRound,
  browser_console_exec: SquareTerminal,
  browser_console_view: Terminal,
  document_read: BookOpen,
  database_create: Database,
  database_query: Table2,
  database_schema: Table2,
  computer_screenshot: Camera,
  computer_action: MousePointer2,
  preview_start: Rocket,
  preview_stop: Square,
  plan_create: ClipboardList,
  agent_spawn: GitFork,
  agent_send: Send,
  agent_receive: Inbox,
  agent_wait: Clock,
  activate_skill: Sparkles,
  load_skill: BookMarked,
};

const CATEGORY_FALLBACK: Record<ToolCategory, LucideIcon> = {
  code: Code,
  file: FileText,
  search: Globe,
  memory: Library,
  browser: Compass,
  computer: MousePointer2,
  preview: Eye,
  mcp: Plug,
  agent: GitBranch,
  database: Database,
  default: Wrench,
};

/** Icons cycled by stable hash for arbitrary skill names. */
const SKILL_ICON_POOL: readonly LucideIcon[] = [
  Sparkles,
  BookMarked,
  Zap,
  Cpu,
  Target,
  Shield,
  FlaskConical,
  Workflow,
  Puzzle,
  Layers,
  PenTool,
  LineChart,
  Wand2,
  ScrollText,
  GraduationCap,
  Lightbulb,
  Hammer,
  Telescope,
  Network,
  GitBranch,
  Compass,
  Braces,
  Image,
];

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Deterministic icon for a skill id (raw `name` from tool input), so the same skill
 * always shows the same glyph in progress and computer panels.
 */
export function getSkillIcon(skillId: string): LucideIcon {
  const key = skillId.trim().toLowerCase() || "skill";
  const idx = stableHash(key) % SKILL_ICON_POOL.length;
  return SKILL_ICON_POOL[idx] ?? Sparkles;
}

export function getToolIcon(toolName: string): LucideIcon {
  if (toolName.includes("__")) {
    return Plug;
  }
  const direct = TOOL_ICONS[toolName];
  if (direct) return direct;
  return CATEGORY_FALLBACK[getToolCategory(toolName)] ?? Wrench;
}

/**
 * Icon for a timeline step: tool by raw name, skill by normalized display name.
 */
export function getTimelineToolOrSkillIcon(
  kind: "tool" | "skill",
  rawToolName: string | undefined,
  skillKey: string | undefined,
  displayName: string | undefined,
): LucideIcon {
  if (kind === "skill") {
    const fromKey = skillKey?.trim();
    if (fromKey) return getSkillIcon(fromKey);
    const id =
      displayName?.trim()
        ? displayName.trim().toLowerCase().replace(/\s+/g, "-")
        : "skill";
    return getSkillIcon(id);
  }
  if (rawToolName) return getToolIcon(rawToolName);
  return Wrench;
}
