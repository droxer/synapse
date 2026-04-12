import { API_BASE } from "@/shared/constants";

export interface ConversationUsage {
  readonly conversation_id: string;
  /** Conversation task title when returned from the paginated user usage list. */
  readonly title?: string | null;
  readonly user_id: string | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly request_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UserUsageSummary {
  readonly user_id: string;
  readonly total_input_tokens: number;
  readonly total_output_tokens: number;
  readonly total_requests: number;
  readonly conversation_count: number;
}

export async function fetchConversationUsage(
  conversationId: string,
): Promise<ConversationUsage> {
  const res = await fetch(`${API_BASE}/usage/conversation/${conversationId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch conversation usage: ${res.status}`);
  }
  return res.json();
}

export async function fetchUserUsage(
  since?: string,
): Promise<UserUsageSummary> {
  let url = `${API_BASE}/usage/user`;
  if (since) {
    url += `?since=${encodeURIComponent(since)}`;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch user usage: ${res.status}`);
  }
  return res.json();
}

export interface ConversationUsagePage {
  readonly items: readonly ConversationUsage[];
  readonly total: number;
}

export async function fetchUserConversationUsage(
  limit: number,
  offset: number,
): Promise<ConversationUsagePage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${API_BASE}/usage/user/conversations?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch conversation usage list: ${res.status}`);
  }
  return res.json();
}
