"""Tests for skill-name fallback in ToolExecutor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.base import ExecutionContext, SandboxTool, ToolDefinition, ToolResult
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


def test_canonical_tool_call_payload_normalizes_skill_alias() -> None:
    registry = _build_skill_registry()
    tool_registry = ToolRegistry().register(ActivateSkill(skill_registry=registry))
    executor = ToolExecutor(registry=tool_registry)

    tool_name, tool_input = executor.canonical_tool_call_event_payload("docx", {})

    assert tool_name == "activate_skill"
    assert tool_input == {"name": "docx"}


class _RecordingSession:
    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> Any:
        del command, timeout, workdir
        raise AssertionError("unexpected session.exec call")


class _FakeSandboxProvider:
    def __init__(self) -> None:
        self.session = _RecordingSession()

    async def create_session(self, config: Any) -> _RecordingSession:
        del config
        return self.session


class _RecordingShellExec(SandboxTool):
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="shell_exec",
            description="Execute a shell command.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.SANDBOX,
            tags=("shell", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        self.calls.append({"session": session, **kwargs})
        return ToolResult.ok("ok")


@pytest.mark.asyncio
async def test_executor_defaults_shell_exec_workdir_to_active_skill_directory() -> None:
    tool = _RecordingShellExec()
    provider = _FakeSandboxProvider()
    executor = ToolExecutor(
        registry=ToolRegistry().register(tool),
        sandbox_provider=provider,
    )
    executor.set_active_skill_directory("/home/user/skills/docx")

    result = await executor.execute(
        "shell_exec",
        {"command": "python scripts/comment.py unpacked 0 hi"},
    )

    assert result.success
    assert tool.calls == [
        {
            "session": provider.session,
            "command": "python scripts/comment.py unpacked 0 hi",
            "workdir": "/home/user/skills/docx",
            "event_emitter": None,
            "conversation_id": None,
        }
    ]


@pytest.mark.asyncio
async def test_executor_preserves_explicit_shell_exec_workdir() -> None:
    tool = _RecordingShellExec()
    provider = _FakeSandboxProvider()
    executor = ToolExecutor(
        registry=ToolRegistry().register(tool),
        sandbox_provider=provider,
    )
    executor.set_active_skill_directory("/home/user/skills/docx")

    result = await executor.execute(
        "shell_exec",
        {
            "command": "python scripts/comment.py unpacked 0 hi",
            "workdir": "/workspace/custom",
        },
    )

    assert result.success
    assert tool.calls == [
        {
            "session": provider.session,
            "command": "python scripts/comment.py unpacked 0 hi",
            "workdir": "/workspace/custom",
            "event_emitter": None,
            "conversation_id": None,
        }
    ]
