"""Tests for skill-name fallback in ToolExecutor."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.executor import ToolExecutor
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.registry import ToolRegistry


def _build_skill_registry() -> SkillRegistry:
    skill = SkillContent(
        metadata=SkillMetadata(
            name="docx",
            description="Create and edit Word documents.",
        ),
        instructions="Use docx workflow.",
        directory_path=Path("/tmp/docx"),
        source_type="bundled",
    )
    return SkillRegistry((skill,))


@pytest.mark.asyncio
async def test_executor_treats_skill_name_as_activate_skill_alias() -> None:
    registry = _build_skill_registry()
    tool_registry = ToolRegistry().register(ActivateSkill(skill_registry=registry))
    executor = ToolExecutor(registry=tool_registry)

    result = await executor.execute("docx", {})

    assert result.success
    assert '<skill_content name="docx">' in result.output


@pytest.mark.asyncio
async def test_executor_aliases_skill_name_when_skill_already_active() -> None:
    registry = _build_skill_registry()
    tool_registry = ToolRegistry().register(
        ActivateSkill(skill_registry=registry, active_skill_name="docx")
    )
    executor = ToolExecutor(registry=tool_registry)

    result = await executor.execute("docx", {})

    assert result.success
    assert "already active" in result.output
