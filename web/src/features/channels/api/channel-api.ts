import { API_BASE } from "@/shared/constants";

export interface TelegramProviderStatus {
  configured: boolean;
  linked: boolean;
  enabled: boolean;
  webhook_status: string;
  bot_username?: string;
  bot_user_id?: string;
  masked_token?: string;
  last_error?: string | null;
  display_name?: string;
}

export interface ChannelStatusResponse {
  enabled: boolean;
  providers: {
    telegram: TelegramProviderStatus;
  };
}

export interface TelegramConfigResponse {
  provider: string;
  bot_username: string;
  bot_user_id: string;
  masked_token: string;
  webhook_status: string;
  enabled: boolean;
}

export async function getChannelStatus(): Promise<ChannelStatusResponse> {
  const res = await fetch(`${API_BASE}/channels/status`);
  if (!res.ok) throw new Error(`Failed to get channel status: ${res.status}`);
  return res.json();
}

export async function saveTelegramBotConfig(
  botToken: string,
): Promise<TelegramConfigResponse> {
  const res = await fetch(`${API_BASE}/channels/telegram/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot_token: botToken }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to save Telegram bot config: ${res.status}`);
  }
  return res.json();
}

export async function deleteTelegramBotConfig(): Promise<void> {
  const res = await fetch(`${API_BASE}/channels/telegram/config`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete Telegram bot config: ${res.status}`);
}

export async function createLinkToken(provider = "telegram"): Promise<{
  token: string;
  provider: string;
  expires_in_minutes: number;
}> {
  const res = await fetch(`${API_BASE}/channels/link-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to create link token: ${res.status}`);
  }
  return res.json();
}

export async function listChannelAccounts(): Promise<{
  accounts: Array<{
    id: string;
    provider: string;
    provider_user_id: string;
    display_name: string | null;
    status: string;
    linked_at: string;
  }>;
}> {
  const res = await fetch(`${API_BASE}/channels/accounts`);
  if (!res.ok) throw new Error(`Failed to list accounts: ${res.status}`);
  return res.json();
}

export async function unlinkChannelAccount(accountId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/channels/accounts/${accountId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to unlink account: ${res.status}`);
}

export interface ChannelConversation {
  conversation_id: string;
  provider: string;
  display_name: string | null;
  provider_chat_id: string;
  last_message: string | null;
  last_message_at: string | null;
  session_active: boolean;
}

export async function listChannelConversations(): Promise<{
  conversations: ChannelConversation[];
}> {
  const res = await fetch(`${API_BASE}/channels/conversations`);
  if (!res.ok) throw new Error(`Failed to list channel conversations: ${res.status}`);
  return res.json();
}
