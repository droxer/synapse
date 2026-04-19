import {
  normalizeMessageText,
  toTimestampMs,
} from "./types.ts";
import type {
  ConversationEvent,
  ConversationSummary,
  HistoryMessage,
} from "./types.ts";
import { iterLines, iterSseMessages, parseAgentEvent } from "./sse.ts";

export interface ListConversationOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string | null;
}

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string | null;
  readonly proxySecret?: string | null;
  readonly userGoogleId?: string | null;
  readonly userEmail?: string | null;
  readonly userName?: string | null;
  readonly userPicture?: string | null;
  readonly cookie?: string | null;
  readonly fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  readonly status: number | null;
  readonly body: string;

  constructor(message: string, options?: { status?: number | null; body?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = options?.status ?? null;
    this.body = options?.body ?? "";
  }
}

export interface SynapseApiProtocol {
  listConversations(
    options?: ListConversationOptions,
  ): Promise<ConversationSummary[]>;
  createConversation(
    message: string,
    options?: { usePlanner?: boolean | null },
  ): Promise<string>;
  sendMessage(
    conversationId: string,
    message: string,
    options?: { usePlanner?: boolean | null },
  ): Promise<void>;
  fetchMessages(
    conversationId: string,
  ): Promise<{ title: string; messages: HistoryMessage[] }>;
  fetchEvents(
    conversationId: string,
    options?: { limit?: number },
  ): Promise<ConversationEvent[]>;
  streamEventsOnce(
    conversationId: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ConversationEvent>;
  respondToPrompt(
    conversationId: string,
    requestId: string,
    responseText: string,
  ): Promise<void>;
  cancelTurn(conversationId: string): Promise<void>;
  retryTurn(conversationId: string): Promise<void>;
  close(): Promise<void>;
}

export class SynapseApiClient implements SynapseApiProtocol {
  private readonly baseUrl: string;
  private readonly headers: Headers;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "http://localhost:8000");
    this.headers = buildHeaders(this.baseUrl, options);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async listConversations(
    options: ListConversationOptions = {},
  ): Promise<ConversationSummary[]> {
    const payload = await this.requestJson("conversations", {
      params: {
        limit: String(options.limit ?? 20),
        offset: String(options.offset ?? 0),
        ...(options.search ? { search: options.search } : {}),
      },
    });

    const items = Array.isArray(payload.items) ? payload.items : [];
    return items
      .filter(isRecord)
      .map((item) => ({
        id: String(item.id ?? ""),
        title: String(item.title ?? "Untitled conversation"),
        createdAt: String(item.created_at ?? ""),
        updatedAt: String(item.updated_at ?? ""),
      }));
  }

  async createConversation(
    message: string,
    options: { usePlanner?: boolean | null } = {},
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      message,
      skills: [],
    };
    if (options.usePlanner != null) {
      payload.use_planner = options.usePlanner;
    }

    const response = await this.requestJson("conversations", {
      method: "POST",
      json: payload,
    });

    return String(response.conversation_id ?? "");
  }

  async sendMessage(
    conversationId: string,
    message: string,
    options: { usePlanner?: boolean | null } = {},
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      message,
      skills: [],
    };
    if (options.usePlanner != null) {
      payload.use_planner = options.usePlanner;
    }

    await this.requestJson(`conversations/${conversationId}/messages`, {
      method: "POST",
      json: payload,
    });
  }

  async fetchMessages(
    conversationId: string,
  ): Promise<{ title: string; messages: HistoryMessage[] }> {
    const payload = await this.requestJson(`conversations/${conversationId}/messages`);
    const items = Array.isArray(payload.messages) ? payload.messages : [];

    return {
      title: String(payload.title ?? "Untitled conversation"),
      messages: items.filter(isRecord).map((item) => ({
        id: String(item.id ?? ""),
        role: String(item.role ?? ""),
        content: normalizeMessageText(item.content),
        iteration: typeof item.iteration === "number" ? item.iteration : null,
        timestampMs: toTimestampMs(item.created_at),
      })),
    };
  }

  async fetchEvents(
    conversationId: string,
    options: { limit?: number } = {},
  ): Promise<ConversationEvent[]> {
    const payload = await this.requestJson(
      `conversations/${conversationId}/events/history`,
      {
        params: {
          limit: String(options.limit ?? 2000),
          offset: "0",
        },
      },
    );

    const items = Array.isArray(payload.events) ? payload.events : [];
    return items
      .filter(isRecord)
      .map((item) => ({
        type: String(item.type ?? ""),
        data: isRecord(item.data) ? item.data : {},
        timestampMs: toTimestampMs(item.timestamp),
        iteration: typeof item.iteration === "number" ? item.iteration : null,
      }));
  }

  async *streamEventsOnce(
    conversationId: string,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<ConversationEvent> {
    const response = await this.request(
      `conversations/${conversationId}/events`,
      {
        signal: options.signal,
      },
    );

    if (!response.body) {
      return;
    }

    for await (const frame of iterSseMessages(iterLines(response.body))) {
      if (frame.event === "done") {
        return;
      }

      const event = parseAgentEvent(frame.data, frame.event);
      if (event) {
        yield event;
      }
    }
  }

  async respondToPrompt(
    conversationId: string,
    requestId: string,
    responseText: string,
  ): Promise<void> {
    await this.requestJson(`conversations/${conversationId}/respond`, {
      method: "POST",
      json: {
        request_id: requestId,
        response: responseText,
      },
    });
  }

  async cancelTurn(conversationId: string): Promise<void> {
    await this.requestJson(`conversations/${conversationId}/cancel`, {
      method: "POST",
    });
  }

  async retryTurn(conversationId: string): Promise<void> {
    await this.requestJson(`conversations/${conversationId}/retry`, {
      method: "POST",
    });
  }

  private async requestJson(
    path: string,
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request(path, options);
    const payload = await response.json();
    return isRecord(payload) ? payload : {};
  }

  private async request(
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const url = new URL(path.replace(/^\/+/, ""), `${this.baseUrl}/`);
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers = new Headers(this.headers);
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.json);
    }

    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(
        `Request failed (${response.status}): ${text || response.statusText}`,
        {
          status: response.status,
          body: text,
        },
      );
    }

    return response;
  }
}

interface RequestOptions {
  readonly method?: string;
  readonly json?: unknown;
  readonly params?: Record<string, string>;
  readonly signal?: AbortSignal;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized || "http://localhost:8000";
}

function buildHeaders(baseUrl: string, options: ApiClientOptions): Headers {
  const headers = new Headers();
  if (options.apiKey) {
    headers.set("Authorization", `Bearer ${options.apiKey}`);
  }
  if (options.proxySecret) {
    headers.set("X-Proxy-Secret", options.proxySecret);
  }
  if (options.userGoogleId) {
    headers.set("X-User-Google-Id", options.userGoogleId);
  }
  if (options.userEmail) {
    headers.set("X-User-Email", options.userEmail);
  }
  if (options.userName) {
    headers.set("X-User-Name", options.userName);
  }
  if (options.userPicture) {
    headers.set("X-User-Picture", options.userPicture);
  }
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }
  applyLocalDevIdentity(headers, baseUrl, options);
  return headers;
}

function applyLocalDevIdentity(
  headers: Headers,
  baseUrl: string,
  options: ApiClientOptions,
): void {
  const hasExplicitUserIdentity = Boolean(options.userGoogleId && options.userEmail);
  if (hasExplicitUserIdentity || options.cookie) {
    return;
  }

  const url = new URL(`${baseUrl}/`);
  const isLocalHost =
    url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "0.0.0.0";
  const isDirectBackend =
    url.pathname === "/" || url.pathname === "";

  if (!isLocalHost || !isDirectBackend) {
    return;
  }

  headers.set("X-User-Google-Id", "synapse-tui-local");
  headers.set("X-User-Email", "synapse-tui-local@localhost");
  if (!headers.has("X-User-Name")) {
    headers.set("X-User-Name", "Synapse TUI Local");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
