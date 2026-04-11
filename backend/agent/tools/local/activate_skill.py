"""activate_skill tool — returns full SKILL.md instructions for LLM consumption."""

from __future__ import annotations

from typing import Any

from agent.skills.loader import SkillRegistry
from agent.runtime.skill_setup import build_skill_prompt_content
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult


class ActivateSkill(LocalTool):
    """Tool that activates a skill by returning its full instructions."""

    def __init__(
        self,
        skill_registry: SkillRegistry,
        active_skill_name: str | None = None,
    ) -> None:
        self._registry = skill_registry
        self._active_skill_name = active_skill_name

    @property
    def active_skill_name(self) -> str | None:
        return self._active_skill_name

    # NOTE: No setter — active_skill_name is read-only.
    # To change the active skill, create a new ActivateSkill instance.

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="activate_skill",
            description=(
                "Activate a skill to receive expert methodology for a specific "
                "type of task. Skills are auto-activated when your request matches, "
                "but you can also manually activate for mid-conversation skill "
                "switches or explicit user requests."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the skill to activate.",
                    },
                },
                "required": ["name"],
            },
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        name = kwargs.get("name", "")
        if not name:
            return ToolResult.fail("Missing required parameter: name")

        if name == self._active_skill_name:
            return ToolResult.ok(
                f'Skill "{name}" is already active (auto-activated for this turn).'
            )

        skill = self._registry.find_by_name(name)
        if skill is None:
            available = ", ".join(self._registry.names())
            return ToolResult.fail(
                f"Skill '{name}' not found. Available skills: {available}"
            )

        return ToolResult.ok(build_skill_prompt_content(skill))
