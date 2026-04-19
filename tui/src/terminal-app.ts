import readline from "node:readline";

import { TuiController } from "./controller.ts";
import { renderScreen } from "./render.ts";
import type { FocusArea } from "./render.ts";

export interface TerminalLike {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "keypress", listener: (str: string, key: readline.Key) => void): this;
  off(event: "keypress", listener: (str: string, key: readline.Key) => void): this;
}

export interface OutputLike {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(chunk: string): boolean;
}

export class TerminalTuiApp {
  private static readonly FOCUS_ORDER: FocusArea[] = [
    "sidebar",
    "transcript",
    "activity",
    "composer",
  ];

  private readonly controller: TuiController;
  private readonly input: TerminalLike;
  private readonly output: OutputLike;
  private terminalActive = false;
  private inputBuffer = "";
  private cursorIndex = 0;
  private focus: FocusArea = "composer";
  private sidebarIndex = 0;
  private transcriptScroll = 0;
  private activityScroll = 0;
  private readonly unsubscribe: () => void;
  private readonly keypressHandler: (str: string, key: readline.Key) => void;
  private resolveClose: (() => void) | null = null;

  constructor(
    controller: TuiController,
    input: TerminalLike = process.stdin,
    output: OutputLike = process.stdout,
  ) {
    this.controller = controller;
    this.input = input;
    this.output = output;
    this.unsubscribe = controller.subscribe(() => {
      this.syncSidebarSelection();
      this.render();
    });
    this.keypressHandler = (str, key) => {
      void this.handleKeypress(str, key);
    };
  }

  async run(): Promise<void> {
    this.enterTerminal();
    try {
      await this.controller.initialize();
      this.syncSidebarSelection();
      this.render();

      await new Promise<void>((resolve) => {
        this.resolveClose = resolve;
        readline.emitKeypressEvents(this.input as NodeJS.ReadableStream);
        this.input.on("keypress", this.keypressHandler);
      });
    } catch (error) {
      this.restoreTerminal();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.input.off("keypress", this.keypressHandler);
    this.unsubscribe();
    this.restoreTerminal();
    await this.controller.close();
    this.resolveClose?.();
  }

  private enterTerminal(): void {
    this.output.write("\u001B[?1049h\u001B[?25l");
    this.input.setRawMode?.(true);
    this.input.resume();
    this.terminalActive = true;
  }

  private restoreTerminal(): void {
    if (!this.terminalActive) {
      return;
    }
    this.terminalActive = false;
    this.input.setRawMode?.(false);
    this.input.pause();
    this.output.write("\u001B[?25h\u001B[?1049l");
  }

  private render(): void {
    if (!this.terminalActive) {
      return;
    }
    const screen = renderScreen(
      {
        controller: this.controller,
        sidebarIndex: this.sidebarIndex,
        focus: this.focus,
        inputBuffer: this.inputBuffer,
        cursorIndex: this.cursorIndex,
        transcriptScroll: this.transcriptScroll,
        activityScroll: this.activityScroll,
      },
      this.output.columns ?? 120,
      this.output.rows ?? 32,
    );
    this.output.write("\u001B[2J\u001B[H");
    this.output.write(screen);
  }

  private async handleKeypress(str: string, key: readline.Key): Promise<void> {
    if (key.ctrl && key.name === "c") {
      await this.close();
      return;
    }

    if (!key.ctrl && key.name === "q") {
      await this.close();
      return;
    }

    if (key.ctrl && key.name === "n") {
      this.inputBuffer = "";
      this.cursorIndex = 0;
      this.transcriptScroll = 0;
      this.activityScroll = 0;
      await this.controller.newConversation();
      return;
    }

    if (key.ctrl && key.name === "r") {
      await this.controller.retryTurn();
      return;
    }

    if (key.ctrl && key.name === "k") {
      await this.controller.cancelTurn();
      return;
    }

    if (key.name === "tab") {
      this.rotateFocus(key.shift ? -1 : 1);
      this.render();
      return;
    }

    if (this.focus === "sidebar") {
      await this.handleSidebarKey(key);
      return;
    }

    if (this.focus === "transcript") {
      this.handleScrollableKey("transcript", key);
      return;
    }

    if (this.focus === "activity") {
      this.handleScrollableKey("activity", key);
      return;
    }

    await this.handleComposerKey(str, key);
  }

  private async handleSidebarKey(key: readline.Key): Promise<void> {
    const totalItems = this.controller.recentConversations.length + 1;
    if (key.name === "up") {
      this.sidebarIndex = (this.sidebarIndex - 1 + totalItems) % totalItems;
      this.render();
      return;
    }

    if (key.name === "down") {
      this.sidebarIndex = (this.sidebarIndex + 1) % totalItems;
      this.render();
      return;
    }

    if (key.name === "pageup") {
      this.sidebarIndex = Math.max(0, this.sidebarIndex - 5);
      this.render();
      return;
    }

    if (key.name === "pagedown") {
      this.sidebarIndex = Math.min(totalItems - 1, this.sidebarIndex + 5);
      this.render();
      return;
    }

    if (key.name === "home") {
      this.sidebarIndex = 0;
      this.render();
      return;
    }

    if (key.name === "end") {
      this.sidebarIndex = Math.max(0, totalItems - 1);
      this.render();
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      if (this.sidebarIndex === 0) {
        this.inputBuffer = "";
        this.cursorIndex = 0;
        this.transcriptScroll = 0;
        this.activityScroll = 0;
        await this.controller.newConversation();
        return;
      }
      const conversation = this.controller.recentConversations[this.sidebarIndex - 1];
      if (conversation) {
        this.transcriptScroll = 0;
        this.activityScroll = 0;
        await this.controller.openConversation(conversation.id);
      }
    }
  }

  private handleScrollableKey(target: "transcript" | "activity", key: readline.Key): void {
    switch (key.name) {
      case "up":
        this.adjustScroll(target, 1);
        return;
      case "down":
        this.adjustScroll(target, -1);
        return;
      case "pageup":
        this.adjustScroll(target, this.pageStep());
        return;
      case "pagedown":
        this.adjustScroll(target, -this.pageStep());
        return;
      case "home":
        this.setScroll(target, Number.MAX_SAFE_INTEGER);
        return;
      case "end":
        this.setScroll(target, 0);
        return;
      default:
        return;
    }
  }

  private async handleComposerKey(
    str: string,
    key: readline.Key,
  ): Promise<void> {
    switch (key.name) {
      case "left":
        this.cursorIndex = Math.max(0, this.cursorIndex - 1);
        this.render();
        return;
      case "right":
        this.cursorIndex = Math.min(this.inputBuffer.length, this.cursorIndex + 1);
        this.render();
        return;
      case "home":
        this.cursorIndex = 0;
        this.render();
        return;
      case "end":
        this.cursorIndex = this.inputBuffer.length;
        this.render();
        return;
      case "backspace":
        if (this.cursorIndex > 0) {
          this.inputBuffer =
            `${this.inputBuffer.slice(0, this.cursorIndex - 1)}${this.inputBuffer.slice(this.cursorIndex)}`;
          this.cursorIndex -= 1;
          this.render();
        }
        return;
      case "delete":
        if (this.cursorIndex < this.inputBuffer.length) {
          this.inputBuffer =
            `${this.inputBuffer.slice(0, this.cursorIndex)}${this.inputBuffer.slice(this.cursorIndex + 1)}`;
          this.render();
        }
        return;
      case "escape":
        this.inputBuffer = "";
        this.cursorIndex = 0;
        this.render();
        return;
      case "return":
      case "enter": {
        const toSubmit = this.inputBuffer;
        this.inputBuffer = "";
        this.cursorIndex = 0;
        this.transcriptScroll = 0;
        this.render();
        await this.controller.submitInput(toSubmit);
        return;
      }
      default:
        break;
    }

    if (str && !key.ctrl && !key.meta && !key.sequence?.startsWith("\u001B")) {
      this.inputBuffer =
        `${this.inputBuffer.slice(0, this.cursorIndex)}${str}${this.inputBuffer.slice(this.cursorIndex)}`;
      this.cursorIndex += str.length;
      this.render();
    }
  }

  private syncSidebarSelection(): void {
    if (!this.controller.selectedConversationId) {
      this.sidebarIndex = 0;
      return;
    }
    const index = this.controller.recentConversations.findIndex(
      (item) => item.id === this.controller.selectedConversationId,
    );
    this.sidebarIndex = index >= 0 ? index + 1 : 0;
  }

  private rotateFocus(delta: number): void {
    const currentIndex = TerminalTuiApp.FOCUS_ORDER.indexOf(this.focus);
    const nextIndex =
      (currentIndex + delta + TerminalTuiApp.FOCUS_ORDER.length)
      % TerminalTuiApp.FOCUS_ORDER.length;
    this.focus = TerminalTuiApp.FOCUS_ORDER[nextIndex] ?? "composer";
  }

  private adjustScroll(target: "transcript" | "activity", delta: number): void {
    if (target === "transcript") {
      this.transcriptScroll = Math.max(0, this.transcriptScroll + delta);
    } else {
      this.activityScroll = Math.max(0, this.activityScroll + delta);
    }
    this.render();
  }

  private setScroll(target: "transcript" | "activity", value: number): void {
    if (target === "transcript") {
      this.transcriptScroll = Math.max(0, value);
    } else {
      this.activityScroll = Math.max(0, value);
    }
    this.render();
  }

  private pageStep(): number {
    return Math.max(4, Math.floor((this.output.rows ?? 32) / 4));
  }
}
