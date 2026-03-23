import { API_BASE } from "@/shared/constants";

export interface MemoryEntry {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly scope: "conversation" | "global";
  readonly conversation_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MemoryEntryPage {
  readonly items: readonly MemoryEntry[];
  readonly total: number;
}

export async function fetchMemoryEntries(
  limit: number,
  offset: number,
): Promise<MemoryEntryPage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${API_BASE}/memory?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch memory entries: ${res.status}`);
  }
  return res.json();
}

export async function deleteMemoryEntry(entryId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/memory/${entryId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete memory entry: ${res.status}`);
  }
}
