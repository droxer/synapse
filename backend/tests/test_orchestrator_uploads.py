"""Regression tests for orchestrator upload handling."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from agent.llm.client import LLMResponse, TokenUsage
from agent.runtime.orchestrator import AgentOrchestrator
from agent.sandbox.base import ExecResult
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from api.models import FileAttachment


class _FakeClaudeClient:
    def __init__(self) -> None:
        self.calls = 0
        self.last_messages: list[dict[str, Any]] | None = None

    async def create_message_stream(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        on_text_delta: Any | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        self.calls += 1
        self.last_messages = messages
        return LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _RecordingObserver:
    def __init__(self) -> None:
        self.should_compact_calls: list[tuple[tuple[dict[str, Any], ...], str]] = []
        self.compact_calls: list[tuple[tuple[dict[str, Any], ...], str]] = []

    def should_compact(self, messages, system_prompt="") -> bool:
        self.should_compact_calls.append((messages, system_prompt))
        return True

    async def compact(self, messages, system_prompt=""):
        self.compact_calls.append((messages, system_prompt))
        return messages


class _FakeSession:
    def __init__(
        self, *, fail_upload: bool = False, verify_upload: bool = True
    ) -> None:
        self.fail_upload = fail_upload
        self.verify_upload = verify_upload
        self.files: set[str] = set()

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        import shlex

        parts = shlex.split(command)
        if parts[:2] == ["mkdir", "-p"]:
            return ExecResult(stdout="", stderr="", exit_code=0)
        if parts[:2] == ["test", "-f"]:
            exists = len(parts) >= 3 and parts[2] in self.files
            return ExecResult(stdout="", stderr="", exit_code=0 if exists else 1)
        return ExecResult(stdout="", stderr="", exit_code=0)

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        if self.fail_upload:
            raise RuntimeError("upload broke")
        if self.verify_upload:
            self.files.add(remote_path)


@dataclass
class _FakeExecutor:
    session: _FakeSession

    def __post_init__(self) -> None:
        self.current_template: str | None = None
        self.template_requests: list[str] = []
        self.reset_calls = 0

    def set_sandbox_template(self, template: str) -> None:
        self.current_template = template

    def reset_sandbox_template(self) -> None:
        self.current_template = None
        self.reset_calls += 1

    async def get_sandbox_session(
        self, tool_tags: tuple[str, ...] = ()
    ) -> _FakeSession:
        self.template_requests.append(self.current_template or "default")
        return self.session


def _build_skill_registry() -> SkillRegistry:
    skill = SkillContent(
        metadata=SkillMetadata(
            name="data-analysis",
            description="analyze data charts",
            sandbox_template="data_science",
        ),
        instructions="Use Python.",
        directory_path=Path("/tmp/data-analysis"),
        source_type="bundled",
    )
    return SkillRegistry((skill,))


def _attachment(name: str, content_type: str = "text/plain") -> FileAttachment:
    return FileAttachment(
        filename=name,
        content_type=content_type,
        data=b"hello",
        size=5,
    )


@pytest.mark.asyncio
async def test_skill_selected_template_resets_on_next_turn() -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession())
    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await orchestrator.run("please analyze data", attachments=(_attachment("a.csv"),))
    await orchestrator.run("say hello", attachments=(_attachment("b.txt"),))

    assert executor.template_requests == ["data_science", "default"]
    assert executor.reset_calls == 2


@pytest.mark.asyncio
async def test_explicit_selected_skill_forces_template_without_auto_match() -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession())
    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await orchestrator.run(
        "please help",
        attachments=(_attachment("dataset.csv"),),
        selected_skills=("data-analysis",),
    )

    assert executor.template_requests == ["data_science"]


@pytest.mark.asyncio
async def test_failed_upload_aborts_turn_and_skips_llm() -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession(fail_upload=True))
    emitter = EventEmitter()
    events: list[tuple[EventType, dict[str, Any]]] = []

    async def _collect(event: Any) -> None:
        events.append((event.type, event.data))

    emitter.subscribe(_collect)

    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=emitter,
        system_prompt="test",
    )

    result = await orchestrator.run(
        "use this file", attachments=(_attachment("bad.csv"),)
    )

    assert result.startswith("Error: Failed to upload attached files")
    assert client.calls == 0
    assert orchestrator.get_last_user_message() is None
    assert any(
        event_type == EventType.TASK_ERROR
        and "Failed to upload attached files" in data["error"]
        for event_type, data in events
    )


@pytest.mark.asyncio
async def test_successful_upload_advertises_verified_paths_only() -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession())
    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="test",
    )

    await orchestrator.run("inspect this", attachments=(_attachment("report.csv"),))

    assert client.last_messages is not None
    content = client.last_messages[-1]["content"]
    assert isinstance(content, list)
    text_blocks = [block["text"] for block in content if block.get("type") == "text"]
    assert text_blocks
    assert "/home/user/uploads/report.csv" in text_blocks[0]


@pytest.mark.asyncio
async def test_run_iteration_uses_effective_prompt_for_compaction() -> None:
    client = _FakeClaudeClient()
    observer = _RecordingObserver()
    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=_FakeExecutor(session=_FakeSession()),  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="base prompt",
        observer=observer,  # type: ignore[arg-type]
    )
    state = orchestrator._state.add_message({"role": "user", "content": "hello"})

    result = await orchestrator._run_iteration(
        state,
        tools=[],
        system_prompt="expanded prompt",
    )

    assert result.completed is True
    assert observer.should_compact_calls == [(state.messages, "expanded prompt")]
    assert observer.compact_calls == [(state.messages, "expanded prompt")]
