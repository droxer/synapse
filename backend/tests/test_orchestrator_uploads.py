"""Regression tests for orchestrator upload handling."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from agent.llm.client import LLMContentPolicyError, LLMResponse, TokenUsage
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
        self.last_system: str | None = None
        self.default_model = "test-model"

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
        self.last_system = system
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


class _RejectingClaudeClient:
    default_model = "kimi-k2.5"

    async def create_message_stream(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        on_text_delta: Any | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        raise LLMContentPolicyError(
            "provider rejected recent tool output during content inspection"
        )


class _FakeSession:
    def __init__(
        self,
        *,
        fail_upload: bool = False,
        verify_upload: bool = True,
        fail_dependency_install: bool = False,
    ) -> None:
        self.fail_upload = fail_upload
        self.verify_upload = verify_upload
        self.fail_dependency_install = fail_dependency_install
        self.files: set[str] = set()
        self.uploads: list[str] = []

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
        if self.fail_dependency_install and parts[:2] == ["pip", "install"]:
            return ExecResult(stdout="", stderr="pip install failed", exit_code=1)
        return ExecResult(stdout="", stderr="", exit_code=0)

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        if self.fail_upload:
            raise RuntimeError("upload broke")
        self.uploads.append(remote_path)
        if self.verify_upload:
            self.files.add(remote_path)


@dataclass
class _FakeExecutor:
    session: _FakeSession

    def __post_init__(self) -> None:
        self.current_template: str | None = None
        self.template_requests: list[str] = []
        self.reset_calls = 0
        self.staged_skills_by_template: dict[str, set[str]] = {}

    def set_sandbox_template(self, template: str) -> None:
        self.current_template = template

    def reset_sandbox_template(self) -> None:
        self.current_template = None
        self.reset_calls += 1

    def reset_turn_quotas(self) -> None:
        """Match ToolExecutor API used at turn start."""

    async def get_sandbox_session(
        self, tool_tags: tuple[str, ...] = ()
    ) -> _FakeSession:
        self.template_requests.append(self.current_template or "default")
        return self.session

    async def get_sandbox_session_for_template(self, template: str) -> _FakeSession:
        self.template_requests.append(template)
        return self.session

    def is_skill_staged(self, template: str, skill_name: str) -> bool:
        return skill_name in self.staged_skills_by_template.get(template, set())

    def mark_skill_staged(self, template: str, skill_name: str) -> None:
        self.staged_skills_by_template.setdefault(template, set()).add(skill_name)

    @property
    def sandbox_config(self):
        return None


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


def _skill_from_tmp(
    tmp_path: Path,
    *,
    name: str = "data-analysis",
    description: str = "analyze data charts",
    dependencies: tuple[str, ...] = (),
) -> SkillRegistry:
    skill_dir = tmp_path / name
    (skill_dir / "scripts").mkdir(parents=True)
    (skill_dir / "references").mkdir()
    (skill_dir / "assets").mkdir()
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\nUse scripts/{name}.py.\n",
        encoding="utf-8",
    )
    (skill_dir / "scripts" / f"{name}.py").write_text("print('ok')\n", encoding="utf-8")
    (skill_dir / "references" / "guide.md").write_text("# guide\n", encoding="utf-8")
    (skill_dir / "assets" / "template.txt").write_text("template\n", encoding="utf-8")
    return SkillRegistry(
        (
            SkillContent(
                metadata=SkillMetadata(
                    name=name,
                    description=description,
                    sandbox_template="data_science",
                    dependencies=dependencies,
                ),
                instructions=f"Use scripts/{name}.py.",
                directory_path=skill_dir,
                source_type="user",
            ),
        )
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

    assert executor.template_requests == ["data_science", "data_science", "default"]
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

    assert executor.template_requests == ["data_science", "data_science"]


@pytest.mark.asyncio
async def test_auto_selected_skill_stages_files_and_uses_sandbox_path(
    tmp_path: Path,
) -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession())
    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="test",
        skill_registry=_skill_from_tmp(tmp_path),
    )

    await orchestrator.run("please analyze data")

    assert "/home/user/skills/data-analysis/SKILL.md" in executor.session.uploads
    assert (
        "/home/user/skills/data-analysis/scripts/data-analysis.py"
        in executor.session.uploads
    )
    assert client.last_system is not None
    assert client.calls == 1
    assert "/home/user/skills/data-analysis" in client.last_system


@pytest.mark.asyncio
async def test_skill_staging_failure_aborts_turn_before_llm_and_emits_setup_error(
    tmp_path: Path,
) -> None:
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
        skill_registry=_skill_from_tmp(tmp_path),
    )

    result = await orchestrator.run("please analyze data")

    assert result.startswith(
        "Error: Failed to prepare skill 'data-analysis' resources:"
    )
    assert client.calls == 0
    assert any(
        event_type == EventType.SKILL_SETUP_FAILED
        and data.get("name") == "data-analysis"
        and data.get("phase") == "resources"
        for event_type, data in events
    )


@pytest.mark.asyncio
async def test_skill_dependency_failure_aborts_turn_before_llm_and_emits_setup_error(
    tmp_path: Path,
) -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession(fail_dependency_install=True))
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
        skill_registry=_skill_from_tmp(tmp_path, dependencies=("pip:pandas",)),
    )

    result = await orchestrator.run("please analyze data")

    assert result.startswith(
        "Error: Failed to install dependencies for skill 'data-analysis':"
    )
    assert client.calls == 0
    assert any(
        event_type == EventType.SKILL_SETUP_FAILED
        and data.get("name") == "data-analysis"
        and data.get("phase") == "dependencies"
        for event_type, data in events
    )


@pytest.mark.asyncio
async def test_skill_staging_is_idempotent_within_same_session(tmp_path: Path) -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession())
    orchestrator = AgentOrchestrator(
        claude_client=client,
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="test",
        skill_registry=_skill_from_tmp(tmp_path),
    )

    await orchestrator.run("please analyze data")
    first_uploads = list(executor.session.uploads)
    await orchestrator.run("please analyze data again")

    assert executor.session.uploads == first_uploads


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
        and data.get("code") == "attachment_upload"
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
async def test_turn_start_event_includes_attachment_metadata() -> None:
    client = _FakeClaudeClient()
    executor = _FakeExecutor(session=_FakeSession())
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

    await orchestrator.run("inspect this", attachments=(_attachment("report.csv"),))

    turn_start = next(
        data for event_type, data in events if event_type == EventType.TURN_START
    )
    assert turn_start["attachments"] == [
        {"name": "report.csv", "size": 5, "type": "text/plain"},
    ]


@pytest.mark.asyncio
async def test_content_policy_failure_emits_non_retryable_task_error() -> None:
    emitter = EventEmitter()
    events: list[tuple[EventType, dict[str, Any]]] = []

    async def _collect(event: Any) -> None:
        events.append((event.type, event.data))

    emitter.subscribe(_collect)

    orchestrator = AgentOrchestrator(
        claude_client=_RejectingClaudeClient(),  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=_FakeExecutor(session=_FakeSession()),  # type: ignore[arg-type]
        event_emitter=emitter,
        system_prompt="test",
    )

    result = await orchestrator.run("inspect this page")

    assert result.startswith("Error: LLM content policy rejection:")
    assert any(
        event_type == EventType.TASK_ERROR
        and data.get("code") == "content_policy"
        and data.get("retryable") is False
        for event_type, data in events
    )


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
