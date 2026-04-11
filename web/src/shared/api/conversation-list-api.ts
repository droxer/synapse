import { API_BASE } from "@/shared/constants";

export interface ConversationListItem {
  readonly id: string;
  readonly title: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly is_running?: boolean;
}

export interface ConversationListResponse {
  readonly items: readonly ConversationListItem[];
  readonly total: number;
}

export async function fetchConversations(
  limit = 20,
  offset = 0,
  search?: string,
): Promise<ConversationListResponse> {
  let url = `${API_BASE}/conversations?limit=${limit}&offset=${offset}`;
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch conversations: ${res.status}`);
  }

  return res.json();
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}`,
    { method: "DELETE" },
  );

  if (!res.ok) {
    throw new Error(`Failed to delete conversation: ${res.status}`);
  }
}
