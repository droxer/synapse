import { API_BASE } from "@/shared/constants";

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly source_path: string;
  readonly source_type: "bundled" | "user" | "project";
  readonly instructions?: string;
}

export interface SkillInstallParams {
  readonly url?: string;
  readonly source?: "git" | "url" | "registry";
  readonly name?: string;
  readonly skill_path?: string;
}

export interface RegistrySearchResult {
  readonly name: string;
  readonly description: string;
}

export async function fetchSkills(): Promise<readonly Skill[]> {
  const res = await fetch(`${API_BASE}/skills`);
  if (!res.ok) {
    throw new Error(`Failed to fetch skills: ${res.status}`);
  }
  const data = await res.json();
  return data.skills;
}

export async function fetchSkillDetail(name: string): Promise<Skill> {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch skill: ${res.status}`);
  }
  return res.json();
}

export async function installSkill(params: SkillInstallParams): Promise<Skill> {
  const res = await fetch(`${API_BASE}/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to install skill: ${detail}`);
  }
  return res.json();
}

export async function uninstallSkill(name: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/skills/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to uninstall skill: ${detail}`);
  }
}

export async function uploadSkill(files: FileList): Promise<Skill> {
  const formData = new FormData();
  for (const file of Array.from(files)) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/skills/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to upload skill: ${detail}`);
  }
  return res.json();
}

export async function searchRegistry(
  query: string,
): Promise<readonly RegistrySearchResult[]> {
  const res = await fetch(
    `${API_BASE}/skills/registry/search?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to search registry: ${res.status}`);
  }
  const data = await res.json();
  return data.results;
}
