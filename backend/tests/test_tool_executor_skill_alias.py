"""Tests for skill-name fallback in ToolExecutor."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from agent.artifacts.manager import Artifact
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.base import LocalTool
from agent.tools.base import ExecutionContext, SandboxTool, ToolDefinition, ToolResult
from agent.tools.executor import ToolExecutor
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType


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


@pytest.fixture(autouse=True)
def _stub_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeSettings:
        MAX_SHELL_TOOLS_PER_TURN = 0

    monkeypatch.setattr(
        "config.settings.get_settings",
        lambda: _FakeSettings(),
    )


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


@pytest.mark.asyncio
async def test_executor_retries_once_after_stale_sandbox_session() -> None:
    tool = _StaleOnceBrowserTool()
    provider = _RotatingSandboxProvider()
    executor = ToolExecutor(
        registry=ToolRegistry().register(tool),
        sandbox_provider=provider,
    )

    result = await executor.execute("browser_view", {})

    assert result.success
    assert result.output == "ok"
    assert len(provider.sessions) == 2
    assert provider.destroyed == [provider.sessions[0]]
    assert tool.sessions == provider.sessions


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


class _RotatingSandboxProvider:
    def __init__(self) -> None:
        self.sessions: list[object] = []
        self.destroyed: list[object] = []

    async def create_session(self, config: Any) -> object:
        del config
        session = object()
        self.sessions.append(session)
        return session

    async def destroy_session(self, session: object) -> None:
        self.destroyed.append(session)


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


class _StaleOnceBrowserTool(SandboxTool):
    def __init__(self) -> None:
        self.sessions: list[object] = []

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_view",
            description="View browser.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.SANDBOX,
            tags=("browser",),
        )

    async def execute(self, session: object, **kwargs: Any) -> ToolResult:
        del kwargs
        self.sessions.append(session)
        if len(self.sessions) == 1:
            raise RuntimeError(
                "stopped: Handle invalidated after stop(). "
                "Use runtime.get() to get a new handle."
            )
        return ToolResult.ok("ok")


class _RecordingArtifactManager:
    def __init__(self) -> None:
        self.extract_from_sandbox = AsyncMock(
            return_value=(
                Artifact(
                    id="artifact-1",
                    path="artifact-1.docx",
                    original_name="palantir-ontology-report.docx",
                    content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size=128,
                    file_path="/workspace/palantir-ontology-report.docx",
                ),
            )
        )


class _PathReportingSandboxTool(SandboxTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="path_reporter",
            description="Return a generated artifact path in text output.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.SANDBOX,
            tags=("sandbox",),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        del session, kwargs
        return ToolResult.ok("文件路径：/workspace/palantir-ontology-report.docx")


class _PathReportingLocalTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="local_path_reporter",
            description="Return a local filesystem path in text output.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
            tags=(),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        del kwargs
        return ToolResult.ok("文件路径：/workspace/palantir-ontology-report.docx")


class _StructuredEchoTool(LocalTool):
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="structured_echo",
            description="Echo a structured payload.",
            input_schema={
                "type": "object",
                "properties": {
                    "count": {"type": "integer"},
                },
                "required": ["count"],
            },
            output_schema={
                "type": "object",
                "properties": {"count": {"type": "integer"}},
                "required": ["count"],
            },
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        self.calls.append(kwargs)
        return ToolResult.ok(json.dumps({"count": kwargs["count"]}))


class _InvalidStructuredOutputTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="bad_structured_output",
            description="Return invalid structured output.",
            input_schema={"type": "object", "properties": {}},
            output_schema={
                "type": "object",
                "properties": {"approved": {"type": "boolean"}},
                "required": ["approved"],
            },
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        del kwargs
        return ToolResult.ok("not-json")


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


@pytest.mark.asyncio
async def test_executor_extracts_artifact_from_any_sandbox_tool_output_text() -> None:
    artifact_manager = _RecordingArtifactManager()
    provider = _FakeSandboxProvider()
    emitter = EventEmitter()
    received: list[Any] = []

    async def subscriber(event: Any) -> None:
        received.append(event)

    emitter.subscribe(subscriber)
    executor = ToolExecutor(
        registry=ToolRegistry().register(_PathReportingSandboxTool()),
        sandbox_provider=provider,
        artifact_manager=artifact_manager,
        event_emitter=emitter,
    )

    result = await executor.execute("path_reporter", {})

    assert result.success
    artifact_manager.extract_from_sandbox.assert_awaited_once_with(
        session=provider.session,
        remote_paths=["/workspace/palantir-ontology-report.docx"],
    )
    assert (result.metadata or {}).get("artifact_ids") == ["artifact-1"]
    assert any(
        event.type == EventType.ARTIFACT_CREATED
        and event.data.get("file_path") == "/workspace/palantir-ontology-report.docx"
        for event in received
    )


@pytest.mark.asyncio
async def test_executor_does_not_extract_artifact_from_local_tool_output_text() -> None:
    artifact_manager = _RecordingArtifactManager()
    executor = ToolExecutor(
        registry=ToolRegistry().register(_PathReportingLocalTool()),
        artifact_manager=artifact_manager,
    )

    result = await executor.execute("local_path_reporter", {})

    assert result.success
    artifact_manager.extract_from_sandbox.assert_not_awaited()


@pytest.mark.asyncio
async def test_executor_reuses_same_artifact_for_duplicate_remote_path_within_turn() -> (
    None
):
    artifact_manager = _RecordingArtifactManager()
    provider = _FakeSandboxProvider()
    emitter = EventEmitter()
    received: list[Any] = []

    async def subscriber(event: Any) -> None:
        received.append(event)

    emitter.subscribe(subscriber)
    executor = ToolExecutor(
        registry=ToolRegistry().register(_PathReportingSandboxTool()),
        sandbox_provider=provider,
        artifact_manager=artifact_manager,
        event_emitter=emitter,
    )

    first = await executor.execute("path_reporter", {})
    second = await executor.execute("path_reporter", {})

    assert first.success
    assert second.success
    artifact_manager.extract_from_sandbox.assert_awaited_once_with(
        session=provider.session,
        remote_paths=["/workspace/palantir-ontology-report.docx"],
    )
    assert (first.metadata or {}).get("artifact_ids") == ["artifact-1"]
    assert (second.metadata or {}).get("artifact_ids") == ["artifact-1"]
    artifact_events = [
        event for event in received if event.type == EventType.ARTIFACT_CREATED
    ]
    assert len(artifact_events) == 1


@pytest.mark.asyncio
async def test_executor_allows_same_remote_path_again_after_turn_reset() -> None:
    artifact_manager = _RecordingArtifactManager()
    provider = _FakeSandboxProvider()
    executor = ToolExecutor(
        registry=ToolRegistry().register(_PathReportingSandboxTool()),
        sandbox_provider=provider,
        artifact_manager=artifact_manager,
    )

    first = await executor.execute("path_reporter", {})
    executor.reset_turn_quotas()
    second = await executor.execute("path_reporter", {})

    assert first.success
    assert second.success
    assert artifact_manager.extract_from_sandbox.await_count == 2


@pytest.mark.asyncio
async def test_executor_rejects_invalid_structured_tool_input() -> None:
    tool = _StructuredEchoTool()
    executor = ToolExecutor(registry=ToolRegistry().register(tool))

    result = await executor.execute("structured_echo", {"count": "three"})

    assert not result.success
    assert "schema validation failed" in (result.error or "").lower()
    assert tool.calls == []


@pytest.mark.asyncio
async def test_executor_rejects_invalid_structured_tool_output() -> None:
    executor = ToolExecutor(
        registry=ToolRegistry().register(_InvalidStructuredOutputTool())
    )

    result = await executor.execute("bad_structured_output", {})

    assert not result.success
    assert "schema validation failed" in (result.error or "").lower()
