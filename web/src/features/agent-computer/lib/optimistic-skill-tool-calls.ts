import type { ToolCallInfo } from "@/shared/types";
import type { PendingSelectedSkill } from "@/features/conversation/hooks/use-conversation";

const SKILL_TOOL_NAMES = new Set(["activate_skill", "load_skill"]);

export function buildOptimisticSkillToolCalls(
  selectedSkills: readonly PendingSelectedSkill[],
  toolCalls: readonly ToolCallInfo[],
): ToolCallInfo[] {
  if (selectedSkills.length === 0) return [];

  const confirmedSkills = new Set<string>();
  for (const toolCall of toolCalls) {
    if (!SKILL_TOOL_NAMES.has(toolCall.name)) continue;
    const skillName = String(toolCall.input.name ?? "").trim();
    if (!skillName) continue;
    confirmedSkills.add(skillName);
  }

  return selectedSkills
    .filter((skill) => !confirmedSkills.has(skill.name))
    .map((skill, index) => ({
      id: `optimistic-skill:${skill.name}:${index}`,
      toolUseId: `optimistic-skill:${skill.name}`,
      name: "activate_skill",
      input: { name: skill.name },
      timestamp: skill.timestamp,
    }));
}
