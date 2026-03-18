import { API_BASE } from "@/shared/constants";

export async function createConversation(
  message: string,
  files?: File[],
  skills?: string[],
  usePlanner?: boolean,
): Promise<{ conversation_id: string }> {
  let res: Response;
  if (files && files.length > 0) {
    const formData = new FormData();
    formData.append("message", message);
    for (const skill of skills ?? []) {
      formData.append("skills", skill);
    }
    for (const file of files) {
      formData.append("files", file);
    }
    if (usePlanner) {
      formData.append("use_planner", "true");
    }
    res = await fetch(`${API_BASE}/conversations`, {
      method: "POST",
      body: formData,
    });
  } else {
    res = await fetch(`${API_BASE}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        skills: skills ?? [],
        ...(usePlanner ? { use_planner: true } : {}),
      }),
    });
  }

  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.status}`);
  }

  return res.json();
}

export async function sendFollowUpMessage(
  conversationId: string,
  message: string,
  files?: File[],
  skills?: string[],
  usePlanner?: boolean,
): Promise<void> {
  let res: Response;
  if (files && files.length > 0) {
    const formData = new FormData();
    formData.append("message", message);
    for (const skill of skills ?? []) {
      formData.append("skills", skill);
    }
    for (const file of files) {
      formData.append("files", file);
    }
    if (usePlanner) {
      formData.append("use_planner", "true");
    }
    res = await fetch(
      `${API_BASE}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: formData,
      },
    );
  } else {
    res = await fetch(
      `${API_BASE}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          skills: skills ?? [],
          ...(usePlanner ? { use_planner: true } : {}),
        }),
      },
    );
  }

  if (!res.ok) {
    throw new Error(`Failed to send message: ${res.status}`);
  }
}

export async function cancelTurn(
  conversationId: string,
): Promise<{ status: string }> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/cancel`,
    { method: "POST" },
  );

  if (!res.ok) {
    throw new Error(`Failed to cancel turn: ${res.status}`);
  }

  return res.json();
}

export async function retryTurn(
  conversationId: string,
): Promise<{ status: string; message?: string }> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/retry`,
    { method: "POST" },
  );

  if (!res.ok) {
    throw new Error(`Failed to retry turn: ${res.status}`);
  }

  return res.json();
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
