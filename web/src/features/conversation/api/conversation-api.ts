import { API_BASE } from "@/shared/constants";

export async function createConversation(
  message: string,
): Promise<{ conversation_id: string }> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.status}`);
  }

  return res.json();
}

export async function sendFollowUpMessage(
  conversationId: string,
  message: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to send message: ${res.status}`);
  }
}

export async function respondToAgent(
  conversationId: string,
  requestId: string,
  response: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, response }),
    },
  );

  if (!res.ok) {
    throw new Error(`Server responded with ${res.status}`);
  }
}
