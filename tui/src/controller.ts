import { ApiError, SynapseApiClient } from "./api-client.ts";
import type { SynapseApiProtocol } from "./api-client.ts";
import { ConversationStore } from "./store.ts";
import {
  DEFAULT_TUI_CONFIG,
} from "./types.ts";
import type {
  ConversationSummary,
  TranscriptEntry,
  TuiConfig,
} from "./types.ts";

export class TuiController {
  readonly config: TuiConfig;
  readonly apiClient: SynapseApiProtocol;
  readonly store = new ConversationStore();

  recentConversations: ConversationSummary[] = [];
  selectedConversationId: string | null;

  private readonly listeners = new Set<() => void>();
  private streamAbortController: AbortController | null = null;
  private streamPromise: Promise<void> | null = null;
  private isLoadingSidebar = false;
  private closed = false;

  constructor(options: {
    config?: Partial<TuiConfig>;
    apiClient?: SynapseApiProtocol;
  } = {}) {
    this.config = { ...DEFAULT_TUI_CONFIG, ...options.config };
    this.apiClient =
      options.apiClient
      ?? new SynapseApiClient({
        baseUrl: this.config.apiUrl,
        apiKey: this.config.apiKey,
        proxySecret: this.config.proxySecret,
        userGoogleId: this.config.userGoogleId,
        userEmail: this.config.userEmail,
        userName: this.config.userName,
        userPicture: this.config.userPicture,
        cookie: this.config.cookie,
      });
    this.selectedConversationId = this.config.conversationId;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async initialize(): Promise<void> {
    await this.refreshSidebar();
    if (this.config.conversationId) {
      await this.openConversation(this.config.conversationId);
      return;
    }

    if (this.store.view.transcript.length > 0) {
      this.notify();
      return;
    }

    this.store.reset();
    this.notify();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stopStream();
    await this.apiClient.close();
  }

  async newConversation(): Promise<void> {
    await this.stopStream();
    this.store.reset();
    this.selectedConversationId = null;
    await this.refreshSidebar();
    this.notify();
  }

  async retryTurn(): Promise<void> {
    const conversationId = this.store.view.conversationId;
    if (!conversationId) {
      return;
    }

    try {
      await this.apiClient.retryTurn(conversationId);
    } catch (error) {
      this.recordLocalError(`Retry failed: ${formatApiError(error)}`);
      return;
    }

    await this.startStreamIfNeeded(true);
    await this.refreshSidebar();
  }

  async cancelTurn(): Promise<void> {
    const conversationId = this.store.view.conversationId;
    if (!conversationId) {
      return;
    }

    try {
      await this.apiClient.cancelTurn(conversationId);
    } catch (error) {
      this.recordLocalError(`Cancel failed: ${formatApiError(error)}`);
      return;
    }

    await this.startStreamIfNeeded(true);
  }

  async submitInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const pendingAsk = this.store.view.pendingAsk;
    try {
      if (pendingAsk && this.store.view.conversationId) {
        await this.apiClient.respondToPrompt(
          this.store.view.conversationId,
          pendingAsk.requestId,
          trimmed,
        );
        this.store.view.pendingAsk = null;
        await this.startStreamIfNeeded(true);
      } else if (this.store.view.conversationId) {
        await this.apiClient.sendMessage(
          this.store.view.conversationId,
          trimmed,
          { usePlanner: this.config.usePlanner },
        );
        await this.startStreamIfNeeded(true);
      } else {
        const conversationId = await this.apiClient.createConversation(
          trimmed,
          { usePlanner: this.config.usePlanner },
        );
        this.store.view.conversationId = conversationId;
        this.selectedConversationId = conversationId;
        await this.refreshSidebar();
        await this.startStreamIfNeeded(true);
      }
    } catch (error) {
      this.recordLocalError(`Request failed: ${formatApiError(error)}`);
      return;
    }

    this.notify();
  }

  async openConversation(conversationId: string): Promise<void> {
    await this.stopStream();

    try {
      const [{ title, messages }, events] = await Promise.all([
        this.apiClient.fetchMessages(conversationId),
        this.apiClient.fetchEvents(conversationId, { limit: 2000 }),
      ]);
      this.store.hydrate(conversationId, title, messages, events);
      this.store.setConnectionStatus("disconnected");
      this.selectedConversationId = conversationId;
      this.notify();
      await this.refreshSidebar();
      await this.startStreamIfNeeded(false);
    } catch (error) {
      this.recordLocalError(`Failed to open conversation: ${formatApiError(error)}`);
    }
  }

  async refreshSidebar(): Promise<void> {
    if (this.isLoadingSidebar) {
      return;
    }

    this.isLoadingSidebar = true;
    try {
      this.recentConversations = await this.apiClient.listConversations({
        limit: 20,
      });
    } catch (error) {
      this.recordLocalError(
        `Failed to load recent conversations: ${formatApiError(error)}`,
      );
      return;
    } finally {
      this.isLoadingSidebar = false;
    }

    this.notify();
  }

  private async startStreamIfNeeded(force: boolean): Promise<void> {
    const conversationId = this.store.view.conversationId;
    if (!conversationId) {
      return;
    }
    if (!force && !this.store.isLiveTurnActive()) {
      return;
    }

    await this.stopStream();
    const abortController = new AbortController();
    this.streamAbortController = abortController;
    this.streamPromise = this.streamLoop(conversationId, abortController.signal)
      .finally(() => {
        if (this.streamAbortController === abortController) {
          this.streamAbortController = null;
        }
        if (this.streamPromise) {
          this.streamPromise = null;
        }
      });
  }

  private async stopStream(): Promise<void> {
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
    if (this.streamPromise) {
      try {
        await this.streamPromise;
      } catch {
        // Ignore abort-path failures during shutdown or thread switches.
      }
      this.streamPromise = null;
    }
  }

  private async streamLoop(
    conversationId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let firstAttempt = true;
    let retryCount = 0;

    while (
      !this.closed
      && !signal.aborted
      && this.store.view.conversationId === conversationId
    ) {
      this.store.setConnectionStatus(
        firstAttempt ? "connecting" : "reconnecting",
      );
      this.notify();

      try {
        for await (const event of this.apiClient.streamEventsOnce(conversationId, { signal })) {
          if (signal.aborted || this.closed) {
            return;
          }
          this.store.setConnectionStatus("connected");
          this.store.applyEvent(event);
          this.notify();
          if (event.type === "conversation_title") {
            await this.refreshSidebar();
          }
          if (!this.store.isLiveTurnActive()) {
            this.store.setConnectionStatus("disconnected");
            this.notify();
            return;
          }
        }

        this.store.setConnectionStatus("disconnected");
        this.notify();
        return;
      } catch (error) {
        if (signal.aborted || this.closed || isAbortError(error)) {
          return;
        }

        retryCount += 1;
        this.recordLocalError(
          `Stream interrupted: ${formatApiError(error)}`,
          false,
        );
        this.store.setConnectionStatus("reconnecting");
        this.notify();
        await sleep(Math.min(5000, retryCount * 1000), signal);
        firstAttempt = false;
      }
    }
  }

  private recordLocalError(message: string, notify = true): void {
    this.store.view.transcript.push(this.systemMessage(message));
    if (notify) {
      this.notify();
    }
  }

  private systemMessage(content: string): TranscriptEntry {
    return {
      role: "system",
      content,
      timestampMs: Date.now(),
      thinking: "",
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return (
        `Authentication failed (${error.status}). `
        + "Use a direct backend API key, or provide proxy/session auth headers "
        + `for authenticated setups. Server response: ${error.body || error.message}`
      );
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function sleep(durationMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    function onAbort(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
