import { TuiController } from "./controller.ts";
import { renderMarkdown } from "./markdown.ts";
import type { AgentStatus, ToolCallState, TranscriptEntry } from "./types.ts";

export type FocusArea = "sidebar" | "transcript" | "activity" | "composer";
export type LayoutMode = "wide" | "stacked" | "narrow";

export interface RenderModel {
  readonly controller: TuiController;
  readonly sidebarIndex: number;
  readonly focus: FocusArea;
  readonly inputBuffer: string;
  readonly cursorIndex: number;
  readonly transcriptScroll: number;
  readonly activityScroll: number;
}

export function resolveLayoutMode(width: number): LayoutMode {
  if (width >= 150) {
    return "wide";
  }
  if (width >= 105) {
    return "stacked";
  }
  return "narrow";
}

export function renderScreen(
  model: RenderModel,
  width: number,
  height: number,
): string {
  const safeWidth = Math.max(80, width);
  const safeHeight = Math.max(24, height);
  const layoutMode = resolveLayoutMode(safeWidth);

  const statusLines = renderStatus(model, safeWidth);
  const footerLines = renderFooter(model, safeWidth);
  const bodyHeight = Math.max(10, safeHeight - statusLines.length - footerLines.length);

  const body = renderBody(model, safeWidth, bodyHeight, layoutMode);
  return [...statusLines, ...body, ...footerLines].join("\n");
}

export function buildTranscriptContentLines(
  model: RenderModel,
  width: number,
): string[] {
  const state = model.controller.store.view;
  const lines: string[] = [];

  if (state.transcript.length === 0 && !hasLiveTurnContent(state)) {
    lines.push("Start a new conversation from the composer below.");
  } else {
    for (const entry of state.transcript) {
      lines.push(...formatTranscriptEntry(entry, width));
    }
  }

  const liveLines = buildLiveTurnLines(model, width);
  if (liveLines.length > 0) {
    if (lines.length > 0) {
      lines.push("");
      lines.push("-".repeat(Math.max(12, Math.min(width, 24))));
    }
    lines.push(...liveLines);
  }

  return lines;
}

export function buildActivityContentLines(
  model: RenderModel,
  width: number,
): string[] {
  const state = model.controller.store.view;
  const lines = [
    "[Turn]",
    ...wrapText(
      `status=${state.turnStatus} phase=${state.assistantPhase || "idle"} connection=${state.connectionStatus}`,
      width,
    ),
    "",
    "[Plan]",
    ...renderPlanSteps(state.planSteps, width),
    "",
    "[Tools]",
    ...renderTools(model.controller.store, state.toolCalls.slice(-8), width),
    "",
    "[Workers]",
    ...renderAgents(state.agentStatuses.slice(-8), width),
  ];

  if (state.pendingAsk) {
    lines.push(
      "",
      "[Needs Input]",
      ...wrapText(state.pendingAsk.question, width),
    );
  }

  return lines;
}

function renderBody(
  model: RenderModel,
  width: number,
  height: number,
  layoutMode: LayoutMode,
): string[] {
  if (layoutMode === "wide") {
    return renderWideBody(model, width, height);
  }
  if (layoutMode === "stacked") {
    return renderStackedBody(model, width, height);
  }
  return renderNarrowBody(model, width, height);
}

function renderWideBody(
  model: RenderModel,
  width: number,
  height: number,
): string[] {
  const sideWidth = Math.max(34, Math.min(42, Math.floor(width * 0.28)));
  const transcriptWidth = Math.max(40, width - sideWidth - 1);
  const sidebarHeight = Math.max(8, Math.min(12, Math.floor(height * 0.28)));
  const activityHeight = Math.max(8, height - sidebarHeight);

  const transcriptPanel = drawScrollablePanel(
    buildTranscriptTitle(model),
    buildTranscriptContentLines(model, transcriptWidth - 4),
    transcriptWidth,
    height,
    model.transcriptScroll,
    model.focus === "transcript",
  );
  const sidebarPanel = drawStaticPanel(
    buildSidebarTitle(model),
    buildSidebarContentLines(model, sideWidth - 4),
    sideWidth,
    sidebarHeight,
  );
  const activityPanel = drawScrollablePanel(
    buildActivityTitle(model),
    buildActivityContentLines(model, sideWidth - 4),
    sideWidth,
    activityHeight,
    model.activityScroll,
    model.focus === "activity",
  );

  const sideRail = [...sidebarPanel, ...activityPanel];
  return mergeColumns([transcriptPanel, sideRail]);
}

function renderStackedBody(
  model: RenderModel,
  width: number,
  height: number,
): string[] {
  const transcriptHeight = Math.max(10, Math.floor(height * 0.62));
  const bottomHeight = Math.max(8, height - transcriptHeight);
  const sidebarWidth = Math.max(24, Math.min(32, Math.floor(width * 0.32)));
  const activityWidth = Math.max(34, width - sidebarWidth - 1);

  const transcriptPanel = drawScrollablePanel(
    buildTranscriptTitle(model),
    buildTranscriptContentLines(model, width - 4),
    width,
    transcriptHeight,
    model.transcriptScroll,
    model.focus === "transcript",
  );
  const sidebarPanel = drawStaticPanel(
    buildSidebarTitle(model),
    buildSidebarContentLines(model, sidebarWidth - 4),
    sidebarWidth,
    bottomHeight,
  );
  const activityPanel = drawScrollablePanel(
    buildActivityTitle(model),
    buildActivityContentLines(model, activityWidth - 4),
    activityWidth,
    bottomHeight,
    model.activityScroll,
    model.focus === "activity",
  );

  return [
    ...transcriptPanel,
    ...mergeColumns([sidebarPanel, activityPanel]),
  ];
}

function renderNarrowBody(
  model: RenderModel,
  width: number,
  height: number,
): string[] {
  const transcriptHeight = Math.max(9, Math.floor(height * 0.5));
  const activityHeight = Math.max(7, Math.floor((height - transcriptHeight) * 0.55));
  const sidebarHeight = Math.max(6, height - transcriptHeight - activityHeight);

  return [
    ...drawScrollablePanel(
      buildTranscriptTitle(model),
      buildTranscriptContentLines(model, width - 4),
      width,
      transcriptHeight,
      model.transcriptScroll,
      model.focus === "transcript",
    ),
    ...drawScrollablePanel(
      buildActivityTitle(model),
      buildActivityContentLines(model, width - 4),
      width,
      activityHeight,
      model.activityScroll,
      model.focus === "activity",
    ),
    ...drawStaticPanel(
      buildSidebarTitle(model),
      buildSidebarContentLines(model, width - 4),
      width,
      sidebarHeight,
    ),
  ];
}

function renderStatus(model: RenderModel, width: number): string[] {
  const state = model.controller.store.view;
  const startupError = getStartupError(model);
  const parts = [
    "Synapse TUI",
    state.title || "New conversation",
    formatConnectionBadge(state.connectionStatus),
    `turn=${state.turnStatus}`,
    `focus=${model.focus}`,
  ];

  if (state.orchestratorMode && state.orchestratorMode !== "agent") {
    parts.push(`mode=${state.orchestratorMode}`);
  }
  if (state.pendingAsk) {
    parts.push("awaiting-input");
  }
  if (startupError) {
    parts.push("startup-error");
  }

  return [
    clipLine(parts.join(" | "), width),
    startupError
      ? clipLine(`Last startup issue: ${startupError}`, width)
      : "-".repeat(width),
  ];
}

function renderFooter(model: RenderModel, width: number): string[] {
  const focusHint = {
    sidebar:
      "Sidebar: Up/Down move selection | PgUp/PgDn jump | Home/End bounds | Enter open/new",
    transcript:
      "Transcript: Up/Down scroll | PgUp/PgDn page | Home oldest | End latest",
    activity:
      "Activity: Up/Down scroll | PgUp/PgDn page | Home oldest | End latest",
    composer:
      "Composer: type to edit | Left/Right move cursor | Home/End jump | Enter send | Esc clear",
  }[model.focus];

  const globalHint =
    "Tab/Shift+Tab focus | Ctrl+N new | Ctrl+R retry | Ctrl+K cancel | q quit | Ctrl+C force quit";

  return [
    "=".repeat(width),
    clipLine(renderComposerLine(model), width),
    clipLine(focusHint, width),
    clipLine(globalHint, width),
  ];
}

function buildSidebarTitle(model: RenderModel): string {
  const active = model.focus === "sidebar" ? " *" : "";
  return `Conversations${active}`;
}

function buildTranscriptTitle(model: RenderModel): string {
  const active = model.focus === "transcript" ? " *" : "";
  const scroll = model.transcriptScroll > 0 ? " scrolled" : " latest";
  return `Transcript${active}${scroll}`;
}

function buildActivityTitle(model: RenderModel): string {
  const active = model.focus === "activity" ? " *" : "";
  const scroll = model.activityScroll > 0 ? " scrolled" : " latest";
  return `Live Activity${active}${scroll}`;
}

function buildSidebarContentLines(
  model: RenderModel,
  width: number,
): string[] {
  const entries = ["New conversation", ...model.controller.recentConversations.map((conversation) => {
    const stamp = formatIso(conversation.updatedAt);
    return `${conversation.title.trim() || "Untitled conversation"} (${stamp})`;
  })];
  const clampedIndex = Math.max(0, Math.min(model.sidebarIndex, entries.length - 1));
  const { lines: visible, start } = windowAroundIndex(
    entries,
    clampedIndex,
    Math.max(4, width > 20 ? 8 : 4),
  );

  return visible.flatMap((line, index) => {
    const actualIndex = start + index;
    const selected = actualIndex === clampedIndex;
    const focusMarker = model.focus === "sidebar" && selected ? "*" : " ";
    const selectionMarker = selected ? ">" : " ";
    return wrapText(`${selectionMarker}${focusMarker} ${line}`, width);
  });
}

function buildLiveTurnLines(
  model: RenderModel,
  width: number,
): string[] {
  const state = model.controller.store.view;
  const lines: string[] = [];
  const pendingTool = findPendingTool(state.toolCalls);
  const runningSteps = state.planSteps.filter((step) => step.status === "running").length;
  const pendingSteps = state.planSteps.filter((step) => step.status === "pending").length;

  if (!hasLiveTurnContent(state)) {
    return lines;
  }

  lines.push("[Live Turn]");
  lines.push(
    ...wrapText(
      `state=${state.turnStatus} phase=${state.assistantPhase || "idle"} connection=${state.connectionStatus}`,
      width,
    ),
  );

  if (runningSteps > 0 || pendingSteps > 0) {
    lines.push(
      ...wrapText(
        `planner: ${runningSteps} running, ${pendingSteps} pending`,
        width,
      ),
    );
  }

  if (pendingTool) {
    lines.push(`tool: ${pendingTool.name}`);
    const inputPreview = model.controller.store.renderToolInput(pendingTool);
    if (inputPreview) {
      lines.push(...wrapText(`tool in: ${inputPreview}`, width));
    }
    if (pendingTool.output.trim()) {
      lines.push(...wrapText(`tool out: ${compactBlock(pendingTool.output.trim(), 240)}`, width));
    }
  }

  if (state.pendingAsk) {
    lines.push("");
    lines.push("[Agent Needs Input]");
    lines.push(...wrapText(state.pendingAsk.question, width));
    if (state.pendingAsk.options.length > 0) {
      state.pendingAsk.options.forEach((option, index) => {
        const detail = option.description ? ` - ${option.description}` : "";
        lines.push(...wrapText(`${index + 1}. ${option.label}${detail}`, width));
      });
    }
  }

  if (state.draftThinking.length > 0) {
    lines.push("");
    lines.push("[Thinking]");
    lines.push(...renderMarkdown(state.draftThinking.join("\n\n"), width));
  }

  if (state.draftText.trim()) {
    lines.push("");
    lines.push("[Streaming Response]");
    lines.push(...renderMarkdown(state.draftText.trim(), width));
  } else if (state.turnStatus === "executing" && !state.pendingAsk && !pendingTool) {
    lines.push("");
    lines.push("[Streaming Response]");
    lines.push("Waiting for assistant output...");
  }

  return lines;
}

function formatTranscriptEntry(entry: TranscriptEntry, width: number): string[] {
  const roleLabel = entry.role === "user"
    ? "You"
    : entry.role === "assistant"
      ? "Agent"
      : "System";
  const header = `${roleLabel} @ ${formatTime(entry.timestampMs)}`;
  const lines = [header, "-".repeat(Math.max(12, Math.min(width, header.length)))];

  if (entry.thinking) {
    lines.push("[thinking]");
    lines.push(...renderMarkdown(entry.thinking, width));
    lines.push("");
  }

  lines.push(...renderMarkdown(entry.content, width));
  lines.push("");
  return lines;
}

function renderPlanSteps(
  steps: readonly {
    readonly name: string;
    readonly description: string;
    readonly status: string;
  }[],
  width: number,
): string[] {
  if (steps.length === 0) {
    return ["No active plan."];
  }
  return steps.flatMap((step) => {
    const prefix = step.status === "pending"
      ? "[ ]"
      : step.status === "running"
        ? "[>]"
        : step.status === "complete"
          ? "[ok]"
          : "[x]";
    const lines = [`${prefix} ${step.name}`];
    if (step.description) {
      lines.push(...wrapText(step.description, width));
    }
    return lines;
  });
}

function renderTools(
  controllerStore: Pick<TuiController["store"], "renderToolInput">,
  tools: readonly ToolCallState[],
  width: number,
): string[] {
  if (tools.length === 0) {
    return ["No tool activity yet."];
  }

  return tools.flatMap((tool) => {
    const status = tool.success == null ? "[...]" : tool.success ? "[ok]" : "[x]";
    const lines = [`${status} ${tool.name}`];
    const inputPreview = controllerStore.renderToolInput(tool);
    if (inputPreview) {
      lines.push(...wrapText(`in: ${inputPreview}`, width));
    }
    if (tool.output.trim()) {
      lines.push(...wrapText(`out: ${compactBlock(tool.output.trim(), 180)}`, width));
    }
    return lines;
  });
}

function renderAgents(agents: readonly AgentStatus[], width: number): string[] {
  if (agents.length === 0) {
    return ["No worker activity."];
  }
  return agents.flatMap((agent) => {
    const lines = [`[${agent.status}] ${agent.name}`];
    if (agent.description) {
      lines.push(...wrapText(agent.description, width));
    }
    return lines;
  });
}

function drawStaticPanel(
  title: string,
  contentLines: string[],
  width: number,
  height: number,
): string[] {
  const innerWidth = Math.max(1, width - 4);
  const wrapped = contentLines.flatMap((line) => wrapText(line, innerWidth));
  const visible = takeTail(wrapped, Math.max(0, height - 2));

  return drawPanelFrame(title, visible, width, height);
}

function drawScrollablePanel(
  title: string,
  contentLines: string[],
  width: number,
  height: number,
  scrollOffset: number,
  active: boolean,
): string[] {
  const innerWidth = Math.max(1, width - 4);
  const wrapped = contentLines.flatMap((line) => wrapText(line, innerWidth));
  const windowHeight = Math.max(0, height - 2);
  const visible = takeTailWithOffset(wrapped, windowHeight, scrollOffset);

  const activeTitle = active ? `${title} [focus]` : title;
  return drawPanelFrame(activeTitle, visible, width, height);
}

function drawPanelFrame(
  title: string,
  visible: string[],
  width: number,
  height: number,
): string[] {
  const innerWidth = Math.max(1, width - 4);
  const lines = [
    `+${clipLine(` ${title} `, width - 2).padEnd(width - 2, "-")}+`,
  ];
  for (let index = 0; index < Math.max(0, height - 2); index += 1) {
    const content = visible[index] ?? "";
    lines.push(`| ${clipLine(content, innerWidth).padEnd(innerWidth)} |`);
  }
  lines.push(`+${"-".repeat(width - 2)}+`);
  return lines;
}

function mergeColumns(columns: string[][]): string[] {
  const height = Math.max(...columns.map((column) => column.length));
  const widths = columns.map((column) =>
    Math.max(0, ...column.map((line) => line.length)),
  );
  const lines: string[] = [];

  for (let row = 0; row < height; row += 1) {
    const merged = columns.map((column, index) => {
      const line = column[row] ?? "";
      return line.padEnd(widths[index] ?? 0);
    });
    lines.push(merged.join(" "));
  }

  return lines;
}

function windowAroundIndex(
  lines: string[],
  index: number,
  size: number,
): { lines: string[]; start: number } {
  if (lines.length <= size) {
    return { lines, start: 0 };
  }

  const half = Math.floor(size / 2);
  let start = Math.max(0, index - half);
  const end = Math.min(lines.length, start + size);
  start = Math.max(0, end - size);
  return {
    lines: lines.slice(start, end),
    start,
  };
}

function takeTailWithOffset(
  lines: string[],
  size: number,
  offset: number,
): string[] {
  if (lines.length <= size) {
    return lines;
  }

  const maxOffset = Math.max(0, lines.length - size);
  const clampedOffset = Math.max(0, Math.min(offset, maxOffset));
  const end = Math.max(size, lines.length - clampedOffset);
  const start = Math.max(0, end - size);
  return lines.slice(start, end);
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) {
    return [""];
  }

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!current) {
        current = word;
        continue;
      }
      if (`${current} ${word}`.length <= width) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [""];
}

function takeTail(lines: string[], size: number): string[] {
  if (lines.length <= size) {
    return lines;
  }
  return lines.slice(lines.length - size);
}

function clipLine(line: string, width: number): string {
  if (line.length <= width) {
    return line;
  }
  if (width <= 3) {
    return line.slice(0, width);
  }
  return `${line.slice(0, width - 3)}...`;
}

function withCursor(value: string, cursorIndex: number): string {
  const clamped = Math.max(0, Math.min(cursorIndex, value.length));
  return `${value.slice(0, clamped)}|${value.slice(clamped)}`;
}

function findPendingTool(tools: readonly ToolCallState[]): ToolCallState | null {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (tool && tool.success == null) {
      return tool;
    }
  }
  return null;
}

function hasLiveTurnContent(
  state: TuiController["store"]["view"],
): boolean {
  return Boolean(
    state.draftText.trim()
    || state.draftThinking.length > 0
    || state.pendingAsk
    || state.turnStatus === "planning"
    || state.turnStatus === "executing"
    || findPendingTool(state.toolCalls),
  );
}

function formatConnectionBadge(connectionStatus: string): string {
  if (connectionStatus === "connected") {
    return "connected";
  }
  if (connectionStatus === "connecting") {
    return "connecting";
  }
  if (connectionStatus === "reconnecting") {
    return "reconnecting";
  }
  return "idle";
}

function getStartupError(model: RenderModel): string | null {
  const first = model.controller.store.view.transcript[0];
  if (first?.role !== "system") {
    return null;
  }
  if (!/^Failed to load recent conversations:/i.test(first.content)) {
    return null;
  }
  return first.content;
}

function compactBlock(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function formatIso(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}

function formatTime(timestampMs: number): string {
  if (!timestampMs) {
    return "--:--:--";
  }
  return new Date(timestampMs).toISOString().slice(11, 19);
}

export function renderComposerLine(model: RenderModel): string {
  const focusPrefix = model.focus === "composer" ? "*" : " ";
  return `${focusPrefix} > ${withCursor(model.inputBuffer, model.cursorIndex)}`;
}
