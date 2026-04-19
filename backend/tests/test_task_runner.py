"""Tests for task runner failure modes and metrics."""

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agent.llm.client import LLMResponse, TokenUsage, ToolCall
from agent.runtime.task_runner import TaskAgentConfig, TaskAgentRunner
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType


def _task_settings(timeout_seconds: float = 5.0) -> SimpleNamespace:
    return SimpleNamespace(
        COMPACT_FULL_INTERACTIONS=5,
        COMPACT_FULL_DIALOGUE_TURNS=5,
        COMPACT_TOKEN_BUDGET=150_000,
        COMPACT_SUMMARY_MODEL="",
        LITE_MODEL="claude-lite-test",
        TASK_MODEL="claude-task-test",
        SKILL_SELECTOR_MODEL="",
        SKILL_DEPENDENCY_INSTALL_STRICT=False,
        AGENT_TIMEOUT_SECONDS=timeout_seconds,
    )


class _SequenceClient:
    def __init__(self, *responses: LLMResponse) -> None:
        self._responses = list(responses)
        self.tool_batches: list[set[str]] = []

    async def create_message(self, **kwargs) -> LLMResponse:
        raise RuntimeError("selector unavailable")

    async def create_message_stream(self, **kwargs) -> LLMResponse:
        tools = kwargs.get("tools") or []
        self.tool_batches.append({tool["name"] for tool in tools})
        return self._responses.pop(0)


class _SlowClient:
    async def create_message_stream(self, **kwargs) -> LLMResponse:
        await asyncio.sleep(0.05)
        return LLMResponse(
            text="late reply",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _SequenceExecutor:
    def __init__(self, *results: ToolResult) -> None:
        self._results = list(results)

    def canonical_tool_call_event_payload(
        self, tool_name: str, tool_input: dict[str, object]
    ) -> tuple[str, dict[str, object]]:
        return tool_name, tool_input

    async def execute(self, name: str, tool_input: dict[str, object]) -> ToolResult:
        return self._results.pop(0)


class _FakeSkillSession:
    def __init__(self) -> None:
        self.commands: list[str] = []
        self.uploads: list[str] = []

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ):
        from agent.sandbox.base import ExecResult

        del timeout, workdir
        self.commands.append(command)
        return ExecResult(stdout="", stderr="", exit_code=0)

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        del local_path
        self.uploads.append(remote_path)


class _TaskRunnerExecutor:
    def __init__(self, registry: ToolRegistry, session: _FakeSkillSession) -> None:
        self._registry = registry
        self._session = session
        self.current_template: str | None = None
        self.template_requests: list[str] = []
        self.staged_skills_by_template: dict[str, set[str]] = {}
        self._allowed_tool_names: set[str] | None = None
        self._allowed_tool_tags: set[str] | None = None

    def set_sandbox_template(self, template: str) -> None:
        self.current_template = template

    async def get_sandbox_session(
        self, tool_tags: tuple[str, ...] = ()
    ) -> _FakeSkillSession:
        del tool_tags
        self.template_requests.append(self.current_template or "default")
        return self._session

    async def get_sandbox_session_for_template(
        self, template: str
    ) -> _FakeSkillSession:
        self.template_requests.append(template)
        return self._session

    def is_skill_staged(self, template: str, skill_name: str) -> bool:
        return skill_name in self.staged_skills_by_template.get(template, set())

    def mark_skill_staged(self, template: str, skill_name: str) -> None:
        self.staged_skills_by_template.setdefault(template, set()).add(skill_name)

    def set_allowed_tools(self, names: set[str], tags: set[str]) -> None:
        self._allowed_tool_names = set(names)
        self._allowed_tool_tags = set(tags)

    def reset_allowed_tools(self) -> None:
        self._allowed_tool_names = None
        self._allowed_tool_tags = None

    @property
    def sandbox_config(self):
        return None

    def canonical_tool_call_event_payload(
        self, tool_name: str, tool_input: dict[str, object]
    ) -> tuple[str, dict[str, object]]:
        return tool_name, tool_input

    async def execute(self, name: str, tool_input: dict[str, object]) -> ToolResult:
        tool = self._registry.get(name)
        if tool is None:
            return ToolResult.fail(f"Unknown tool: {name}")
        if self._allowed_tool_names is not None or self._allowed_tool_tags is not None:
            tool_tags = set(tool.definition().tags)
            if (
                self._allowed_tool_names is not None
                and name not in self._allowed_tool_names
                and not (
                    self._allowed_tool_tags is not None
                    and tool_tags & self._allowed_tool_tags
                )
            ):
                return ToolResult.fail(
                    f"Tool '{name}' is not allowed in the current skill/runtime context."
                )
        if isinstance(tool, SandboxTool):
            session = await self.get_sandbox_session(tool.definition().tags)
            return await tool.execute(session=session, **tool_input)
        return await tool.execute(**tool_input)


class _FakeWebSearchTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="web_search",
            description="Search the web.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs) -> ToolResult:
        return ToolResult.ok("ok")


class _FakeMCPTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="demo_server__lookup_docs",
            description="Lookup docs.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
            tags=("mcp", "demo_server"),
        )

    async def execute(self, **kwargs) -> ToolResult:
        return ToolResult.ok("ok")


class _FakeSandboxProbeTool(SandboxTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="sandbox_probe",
            description="Touch the sandbox session.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.SANDBOX,
            tags=("sandbox",),
        )

    async def execute(self, session, **kwargs) -> ToolResult:
        del kwargs
        await session.exec("true")
        return ToolResult.ok("ok")


def _skill_registry() -> SkillRegistry:
    return SkillRegistry(
        (
            SkillContent(
                metadata=SkillMetadata(
                    name="deep-research",
                    description="research a topic thoroughly",
                    allowed_tools=("web_search",),
                ),
                instructions="Use deep research workflow.",
                directory_path=Path("/tmp/deep-research"),
                source_type="bundled",
            ),
            SkillContent(
                metadata=SkillMetadata(
                    name="data-analysis",
                    description="analyze data carefully",
                    sandbox_template="data_science",
                    dependencies=("pandas",),
                ),
                instructions="Use Python.",
                directory_path=Path("/tmp/data-analysis"),
                source_type="bundled",
            ),
        )
    )


class _SkillAwareClient(_SequenceClient):
    async def create_message(self, **kwargs) -> LLMResponse:
        content = kwargs["messages"][0]["content"]
        if "analyze" in content:
            text = '{"skill": "data-analysis"}'
        elif "research" in content:
            text = '{"skill": "deep-research"}'
        else:
            text = '{"skill": null}'
        return LLMResponse(
            text=text,
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _CompactingObserver:
    def __init__(self) -> None:
        self.compact_calls = 0

    def should_compact(
        self, messages: tuple[dict[str, object], ...], system_prompt: str = ""
    ) -> bool:
        return self.compact_calls == 0

    async def compact(
        self,
        messages: tuple[dict[str, object], ...],
        system_prompt: str = "",
    ) -> tuple[dict[str, object], ...]:
        self.compact_calls += 1
        return messages


class _NoopObserver:
    def should_compact(
        self, messages: tuple[dict[str, object], ...], system_prompt: str = ""
    ) -> bool:
        return False

    async def compact(
        self,
        messages: tuple[dict[str, object], ...],
        system_prompt: str = "",
    ) -> tuple[dict[str, object], ...]:
        return messages


@pytest.mark.asyncio
async def test_run_times_out_with_cancel_downstream_failure_mode_and_metrics(
    monkeypatch,
):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=0.01),
    )

    emitter = EventEmitter()
    events = []

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    runner = TaskAgentRunner(
        agent_id="agent-timeout",
        config=TaskAgentConfig(task_description="wait forever"),
        claude_client=_SlowClient(),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(),
        event_emitter=emitter,
        observer=_NoopObserver(),
    )

    result = await runner.run()

    assert result.success is False
    assert result.summary == ""
    assert result.error is not None
    assert "timed out" in result.error.lower()
    assert result.failure_mode == "cancel_downstream"
    assert result.metrics is not None
    assert result.metrics.iterations == 1
    assert result.metrics.tool_call_count == 0
    assert result.metrics.context_compaction_count == 0
    assert result.metrics.input_tokens == 0
    assert result.metrics.output_tokens == 0
    assert result.metrics.duration_seconds >= 0.0

    assert [event for event in events if event.type == EventType.AGENT_COMPLETE] == []


@pytest.mark.asyncio
async def test_run_returns_metrics_for_successful_execution(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    emitter = EventEmitter()
    events = []

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    runner = TaskAgentRunner(
        agent_id="agent-success",
        config=TaskAgentConfig(
            task_description="run a tool and finish",
            name="worker-1",
        ),
        claude_client=_SequenceClient(
            LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(id="tool-1", name="write_file", input={"path": "a.txt"}),
                ),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=11, output_tokens=5),
            ),
            LLMResponse(
                text="completed successfully",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=7, output_tokens=3),
            ),
        ),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(
            ToolResult.ok("saved file", metadata={"artifact_ids": ["artifact-1"]}),
        ),
        event_emitter=emitter,
        observer=_CompactingObserver(),
    )

    result = await runner.run()

    assert result.success is True
    assert result.summary == "completed successfully"
    assert result.failure_mode == "cancel_downstream"
    assert result.artifacts == ("artifact-1",)
    assert result.metrics is not None
    assert result.metrics.iterations == 2
    assert result.metrics.tool_call_count == 1
    assert result.metrics.context_compaction_count == 1
    assert result.metrics.input_tokens == 18
    assert result.metrics.output_tokens == 8
    assert result.metrics.duration_seconds >= 0.0

    assert [event for event in events if event.type == EventType.AGENT_COMPLETE] == []
    compaction_events = [
        event for event in events if event.type == EventType.CONTEXT_COMPACTED
    ]
    assert len(compaction_events) == 1
    assert compaction_events[0].data["summary_scope"] == "task_agent"
    assert compaction_events[0].data["agent_id"] == "agent-success"
    assert compaction_events[0].data["compaction_profile"] == "task_agent"


@pytest.mark.asyncio
async def test_run_emits_text_delta_with_agent_id_and_iteration(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    events = []
    emitter = EventEmitter()

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    class _StreamingClient:
        async def create_message(self, **kwargs) -> LLMResponse:
            raise RuntimeError("selector unavailable")

        async def create_message_stream(self, **kwargs) -> LLMResponse:
            on_text_delta = kwargs["on_text_delta"]
            await on_text_delta("hello ")
            await on_text_delta("world")
            return LLMResponse(
                text="hello world",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=2, output_tokens=2),
            )

    runner = TaskAgentRunner(
        agent_id="agent-stream",
        config=TaskAgentConfig(task_description="stream a result"),
        claude_client=_StreamingClient(),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(),
        event_emitter=emitter,
        observer=_NoopObserver(),
    )

    result = await runner.run()

    assert result.success is True
    text_delta_events = [
        event for event in events if event.type == EventType.TEXT_DELTA
    ]
    assert len(text_delta_events) == 2
    assert [event.data["delta"] for event in text_delta_events] == ["hello ", "world"]
    assert all(event.data["agent_id"] == "agent-stream" for event in text_delta_events)
    assert all(event.iteration == 1 for event in text_delta_events)


def test_task_runner_system_prompt_includes_personal_memory(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: SimpleNamespace(
            **_task_settings().__dict__,
            SKILLS_ENABLED=True,
            MEMORY_PROMPT_ENTRY_MAX_CHARS=300,
            MEMORY_PROMPT_MAX_CHARS=4000,
        ),
    )

    runner = TaskAgentRunner(
        agent_id="agent-memory",
        config=TaskAgentConfig(task_description="respect user prefs"),
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=MagicMock(),
        event_emitter=EventEmitter(),
        observer=_NoopObserver(),
        memory_entries=[{"namespace": "default", "key": "timezone", "value": "UTC"}],
    )

    assert "<personal_memory>" in runner._system_prompt
    assert "timezone: UTC" in runner._system_prompt


@pytest.mark.asyncio
async def test_run_uses_config_timeout_seconds_override(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=1.0),
    )

    emitter = EventEmitter()
    events = []

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    runner = TaskAgentRunner(
        agent_id="agent-timeout-override",
        config=TaskAgentConfig(
            task_description="wait forever",
            timeout_seconds=0.01,
        ),
        claude_client=_SlowClient(),
        tool_registry=ToolRegistry(),
        tool_executor=_SequenceExecutor(),
        event_emitter=emitter,
        observer=_NoopObserver(),
    )

    result = await runner.run()

    assert result.success is False
    assert result.error is not None
    assert "timed out" in result.error.lower()

    assert [event for event in events if event.type == EventType.AGENT_COMPLETE] == []


@pytest.mark.asyncio
async def test_task_runner_auto_selects_skill_and_filters_tools(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_skill_registry()))
    )
    session = _FakeSkillSession()
    client = _SkillAwareClient(
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=2, output_tokens=1),
        )
    )

    runner = TaskAgentRunner(
        agent_id="agent-skill-auto",
        config=TaskAgentConfig(task_description="please research the topic"),
        claude_client=client,
        tool_registry=registry,
        tool_executor=_TaskRunnerExecutor(registry, session),  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        observer=_NoopObserver(),
        skill_registry=_skill_registry(),
    )

    result = await runner.run()

    assert result.success is True
    assert client.tool_batches == [{"activate_skill", "web_search"}]


@pytest.mark.asyncio
async def test_task_runner_mid_turn_skill_activation_restricts_tools(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_skill_registry()))
    )
    session = _FakeSkillSession()
    client = _SkillAwareClient(
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-1",
                    name="activate_skill",
                    input={"name": "deep-research"},
                ),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )

    runner = TaskAgentRunner(
        agent_id="agent-skill-mid-turn",
        config=TaskAgentConfig(task_description="help me"),
        claude_client=client,
        tool_registry=registry,
        tool_executor=_TaskRunnerExecutor(registry, session),  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        observer=_NoopObserver(),
        skill_registry=_skill_registry(),
    )

    result = await runner.run()

    assert result.success is True
    assert client.tool_batches[0] == {
        "activate_skill",
        "demo_server__lookup_docs",
        "web_search",
    }
    assert client.tool_batches[1] == {"activate_skill", "web_search"}


@pytest.mark.asyncio
async def test_task_runner_blocks_same_batch_tool_after_skill_activation(monkeypatch):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    events = []
    emitter = EventEmitter()

    async def _capture(event) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_skill_registry()))
    )
    session = _FakeSkillSession()
    client = _SkillAwareClient(
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-1",
                    name="activate_skill",
                    input={"name": "deep-research"},
                ),
                ToolCall(id="tool-2", name="demo_server__lookup_docs", input={}),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )

    runner = TaskAgentRunner(
        agent_id="agent-skill-same-batch",
        config=TaskAgentConfig(task_description="help me"),
        claude_client=client,
        tool_registry=registry,
        tool_executor=_TaskRunnerExecutor(registry, session),  # type: ignore[arg-type]
        event_emitter=emitter,
        observer=_NoopObserver(),
        skill_registry=_skill_registry(),
    )

    result = await runner.run()

    assert result.success is True
    blocked_result = next(
        event
        for event in events
        if event.type == EventType.TOOL_RESULT and event.data.get("tool_id") == "tool-2"
    )
    assert blocked_result.data["success"] is False
    assert "not allowed" in str(blocked_result.data["output"]).lower()


@pytest.mark.asyncio
async def test_task_runner_reuses_shared_tool_bundle_when_fingerprint_matches(
    monkeypatch,
):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    class _CapturingClient(_SequenceClient):
        def __init__(self, *responses: LLMResponse) -> None:
            super().__init__(*responses)
            self.last_tools_ref = None

        async def create_message_stream(self, **kwargs) -> LLMResponse:
            self.last_tools_ref = kwargs.get("tools")
            return await super().create_message_stream(**kwargs)

    registry = ToolRegistry().register(_FakeWebSearchTool())
    shared_tools = registry.to_anthropic_tools()
    client = _CapturingClient(
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
    )

    runner = TaskAgentRunner(
        agent_id="agent-shared-tools",
        config=TaskAgentConfig(task_description="help me"),
        claude_client=client,
        tool_registry=registry,
        tool_executor=MagicMock(),
        event_emitter=EventEmitter(),
        observer=_NoopObserver(),
        shared_tools=shared_tools,
        shared_tools_fingerprint=registry.anthropic_tools_fingerprint(),
    )

    result = await runner.run()

    assert result.success is True
    assert client.last_tools_ref is shared_tools


@pytest.mark.asyncio
async def test_task_runner_auto_selected_skill_applies_template_and_dependencies(
    monkeypatch,
):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    registry = ToolRegistry().register(ActivateSkill(skill_registry=_skill_registry()))
    session = _FakeSkillSession()
    executor = _TaskRunnerExecutor(registry, session)
    client = _SkillAwareClient(
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
    )

    runner = TaskAgentRunner(
        agent_id="agent-skill-template",
        config=TaskAgentConfig(task_description="analyze this dataset"),
        claude_client=client,
        tool_registry=registry,
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        observer=_NoopObserver(),
        skill_registry=_skill_registry(),
    )

    result = await runner.run()

    assert result.success is True
    assert executor.current_template == "data_science"
    assert executor.template_requests == ["data_science", "data_science"]
    assert any("pip install pandas" in command for command in session.commands)


@pytest.mark.asyncio
async def test_task_runner_reapplies_configured_template_before_first_sandbox_use(
    monkeypatch,
):
    monkeypatch.setattr(
        "agent.runtime.task_runner.get_settings",
        lambda: _task_settings(timeout_seconds=5.0),
    )

    registry = ToolRegistry().register(_FakeSandboxProbeTool())
    session = _FakeSkillSession()
    executor = _TaskRunnerExecutor(registry, session)
    client = _SequenceClient(
        LLMResponse(
            text="",
            tool_calls=(ToolCall(id="tool-1", name="sandbox_probe", input={}),),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )

    runner = TaskAgentRunner(
        agent_id="agent-config-template",
        config=TaskAgentConfig(
            task_description="touch the sandbox",
            sandbox_template="browser",
        ),
        claude_client=client,
        tool_registry=registry,
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        observer=_NoopObserver(),
    )

    result = await runner.run()

    assert result.success is True
    assert executor.current_template == "browser"
    assert executor.template_requests == ["browser"]
