"""Regression tests for runtime guardrails and helper behavior."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.llm.client import LLMResponse, TokenUsage, ToolCall
from agent.llm.client import render_system_prompt
from agent.runtime.helpers import (
    _tool_batch_allows_parallel_execution,
    process_tool_calls,
)
from agent.runtime.message_chain import collect_message_chain_warnings
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.orchestrator import AgentState
from agent.runtime.planner import PlannerOrchestrator
from agent.runtime.task_runner import AgentResult
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from agent.tools.executor import ToolExecutor
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.registry import ToolRegistry
from api.builders import _build_planner_registry
from api.events import EventEmitter, EventType
from api.models import FileAttachment, MCPState


class _SequenceExecutor:
    def __init__(self, *results: ToolResult) -> None:
        self._results = list(results)

    async def execute(self, name: str, tool_input: dict[str, object]) -> ToolResult:
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_process_tool_calls_marks_remaining_calls_skipped_on_early_stop() -> None:
    state = AgentState(iteration=1).add_message(
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "task_complete",
                    "input": {"summary": "done"},
                },
                {
                    "type": "tool_use",
                    "id": "tool-2",
                    "name": "web_search",
                    "input": {"query": "leftover"},
                },
                {
                    "type": "tool_use",
                    "id": "tool-3",
                    "name": "memory_list",
                    "input": {},
                },
            ],
        }
    )
    result = await process_tool_calls(
        state=state,
        tool_calls=(
            ToolCall(id="tool-1", name="task_complete", input={"summary": "done"}),
            ToolCall(id="tool-2", name="web_search", input={"query": "leftover"}),
            ToolCall(id="tool-3", name="memory_list", input={}),
        ),
        executor=_SequenceExecutor(ToolResult.ok("Task marked as complete.")),  # type: ignore[arg-type]
        emitter=EventEmitter(),
        stop_check=lambda: True,
    )

    assert result.processed_count == 1
    last_message = result.state.messages[-1]
    assert last_message["role"] == "user"
    content = last_message["content"]
    assert isinstance(content, list)
    assert len(content) == 3
    assert collect_message_chain_warnings(result.state.messages) == []
    assert content[1]["tool_use_id"] == "tool-2"
    assert content[1]["is_error"] is True
    assert (
        "skipped because the task was already marked complete"
        in content[1]["content"][0]["text"].lower()
    )
    assert content[2]["tool_use_id"] == "tool-3"
    assert content[2]["is_error"] is True


def test_parallel_safe_tool_batch_accepts_memory_search() -> None:
    tool_calls = (
        ToolCall(id="tool-1", name="web_search", input={"query": "alpha"}),
        ToolCall(id="tool-2", name="memory_search", input={"query": "beta"}),
    )

    assert _tool_batch_allows_parallel_execution(tool_calls) is True


class _PlannerClient:
    def __init__(self) -> None:
        self.last_tools: list[dict[str, Any]] | None = None

    async def create_message_stream(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        on_text_delta: Any | None = None,
    ) -> LLMResponse:
        self.last_tools = tools
        return LLMResponse(
            text="planned",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _SerializingPlannerClient:
    def __init__(self) -> None:
        self.active_calls = 0
        self.max_active_calls = 0

    async def create_message_stream(self, **kwargs: Any) -> LLMResponse:
        self.active_calls += 1
        self.max_active_calls = max(self.max_active_calls, self.active_calls)
        try:
            await asyncio.sleep(0.01)
            return LLMResponse(
                text="planned",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )
        finally:
            self.active_calls -= 1


class _FakeMCPTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="demo_server__lookup_docs",
            description="Lookup docs via MCP.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
            tags=("mcp", "demo_server"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        return ToolResult.ok("ok")


class _FakeWebSearchTool(LocalTool):
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="web_search",
            description="Search the web.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        return ToolResult.ok("ok")


class _BlockingPlannerTool(LocalTool):
    def __init__(self, started: asyncio.Event, release: asyncio.Event) -> None:
        self._started = started
        self._release = release

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="blocker",
            description="Block until released.",
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.LOCAL,
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        del kwargs
        self._started.set()
        await self._release.wait()
        return ToolResult.ok("released")


class _SequenceClient:
    def __init__(self, *responses: LLMResponse) -> None:
        self._responses = list(responses)
        self.tool_batches: list[set[str]] = []
        self.default_model = "test-model"

    async def create_message_stream(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        on_text_delta: Any | None = None,
        thinking_budget: int = 0,
    ) -> LLMResponse:
        self.tool_batches.append({tool["name"] for tool in tools or []})
        return self._responses.pop(0)


class _RecordingSequenceClient(_SequenceClient):
    def __init__(self, *responses: LLMResponse) -> None:
        super().__init__(*responses)
        self.message_history: list[list[dict[str, Any]]] = []

    async def create_message_stream(self, **kwargs: Any) -> LLMResponse:
        self.message_history.append(list(kwargs.get("messages", [])))
        return await super().create_message_stream(**kwargs)


class _FakeSession:
    def __init__(self) -> None:
        self.files: set[str] = set()

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> Any:
        from agent.sandbox.base import ExecResult

        import shlex

        parts = shlex.split(command)
        if parts[:2] == ["mkdir", "-p"]:
            return ExecResult(stdout="", stderr="", exit_code=0)
        if parts[:2] == ["test", "-f"]:
            exists = len(parts) >= 3 and parts[2] in self.files
            return ExecResult(stdout="", stderr="", exit_code=0 if exists else 1)
        return ExecResult(stdout="", stderr="", exit_code=0)

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        self.files.add(remote_path)


@dataclass
class _FakePlannerExecutor:
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

    def with_registry(self, registry: ToolRegistry) -> _FakePlannerExecutor:
        return self

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
    return SkillRegistry(
        (
            SkillContent(
                metadata=SkillMetadata(
                    name="deep-research",
                    description="research a topic thoroughly",
                    allowed_tools=("web_search", "web_fetch", "user_message"),
                ),
                instructions="Use deep research workflow.",
                directory_path=Path("/tmp/deep-research"),
                source_type="bundled",
            ),
            SkillContent(
                metadata=SkillMetadata(
                    name="data-analysis",
                    description="analyze data charts",
                    sandbox_template="data_science",
                ),
                instructions="Use Python.",
                directory_path=Path("/tmp/data-analysis"),
                source_type="bundled",
            ),
        )
    )


def _attachment(name: str) -> FileAttachment:
    return FileAttachment(
        filename=name,
        content_type="text/plain",
        data=b"hello",
        size=5,
    )


@pytest.mark.asyncio
async def test_planner_skill_filter_excludes_unlisted_mcp_tools() -> None:
    client = _PlannerClient()
    registry = ToolRegistry().register(_FakeMCPTool())
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        sub_agent_manager=AsyncMock(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await planner.run("please do deep research")

    tool_names = {tool["name"] for tool in client.last_tools or []}
    assert "demo_server__lookup_docs" not in tool_names


def test_planner_registry_excludes_sandbox_tools(monkeypatch) -> None:
    monkeypatch.setattr(
        "api.builders.get_settings",
        lambda: SimpleNamespace(
            TAVILY_API_KEY="test-key",
            SKILLS_ENABLED=True,
        ),
    )

    registry = _build_planner_registry(
        event_emitter=EventEmitter(),
        on_complete=AsyncMock(),
        mcp_state=MCPState(clients={}),
        skill_registry=_build_skill_registry(),
    )

    tool_names = {tool.name for tool in registry.list_tools()}
    assert "web_search" in tool_names
    assert "user_ask" in tool_names
    assert "activate_skill" in tool_names
    assert "shell_exec" not in tool_names
    assert "file_read" not in tool_names
    assert "code_run" not in tool_names
    assert "browser_navigate" not in tool_names


@pytest.mark.asyncio
async def test_planner_resets_skill_selected_template_on_next_turn() -> None:
    client = _PlannerClient()
    executor = _FakePlannerExecutor(session=_FakeSession())
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=executor,  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        sub_agent_manager=AsyncMock(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await planner.run(
        "please analyze data",
        attachments=(_attachment("a.csv"),),
        selected_skills=("data-analysis",),
    )
    await planner.run("say hello", attachments=(_attachment("b.txt"),))

    assert executor.template_requests == ["data_science", "data_science", "default"]
    assert executor.reset_calls == 2


@pytest.mark.asyncio
async def test_planner_serializes_concurrent_runs() -> None:
    client = _SerializingPlannerClient()
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=EventEmitter(),
        sub_agent_manager=MagicMock(cleanup=AsyncMock()),
        system_prompt="test",
    )

    await asyncio.gather(
        planner.run("first turn"),
        planner.run("second turn"),
    )

    assert client.max_active_calls == 1


@pytest.mark.asyncio
async def test_planner_cancel_emits_turn_cancelled_and_cleans_up_workers() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    events: list[EventType] = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event.type)

    emitter.subscribe(_capture)
    cleanup = AsyncMock()
    planner = PlannerOrchestrator(
        claude_client=_SequenceClient(
            LLMResponse(
                text="",
                tool_calls=(ToolCall(id="tool-1", name="blocker", input={}),),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )
        ),  # type: ignore[arg-type]
        tool_registry=ToolRegistry().register(_BlockingPlannerTool(started, release)),
        tool_executor=ToolExecutor(
            registry=ToolRegistry().register(_BlockingPlannerTool(started, release))
        ),
        event_emitter=emitter,
        sub_agent_manager=SimpleNamespace(cleanup=cleanup),
        system_prompt="test",
    )

    run_task = asyncio.create_task(planner.run("cancel me"))
    await started.wait()
    planner.cancel()
    release.set()

    await run_task

    assert EventType.TURN_CANCELLED in events
    cleanup.assert_awaited_once()


@pytest.mark.asyncio
async def test_planner_cancel_interrupts_agent_wait() -> None:
    started = asyncio.Event()
    cleanup = AsyncMock()

    class _WaitingManager:
        async def wait(self, agent_ids=None, cancel_check=None):
            del agent_ids
            started.set()
            while cancel_check is not None and not cancel_check():
                await asyncio.sleep(0)
            raise RuntimeError("agent_wait cancelled")

        async def cleanup(self):
            await cleanup()

    planner = PlannerOrchestrator(
        claude_client=_SequenceClient(
            LLMResponse(
                text="",
                tool_calls=(ToolCall(id="tool-1", name="agent_wait", input={}),),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )
        ),  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=EventEmitter(),
        sub_agent_manager=_WaitingManager(),
        system_prompt="test",
    )

    run_task = asyncio.create_task(planner.run("cancel wait"))
    await started.wait()
    planner.cancel()

    result = await run_task

    assert result == ""
    cleanup.assert_awaited_once()


@pytest.mark.asyncio
async def test_explicit_planner_requires_plan_create_before_completion() -> None:
    events: list[Any] = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    client = _RecordingSequenceClient(
        LLMResponse(
            text="I can answer inline.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-1",
                    name="plan_create",
                    input={
                        "steps": [
                            {
                                "name": "Frame answer",
                                "description": "Outline the response structure.",
                                "execution_type": "planner_owned",
                            }
                        ]
                    },
                ),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="Here is the structured answer.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=emitter,
        sub_agent_manager=SimpleNamespace(cleanup=AsyncMock()),
        system_prompt="test",
    )

    result = await planner.run(
        "How should I approach learning Rust?",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "Here is the structured answer."
    assert any(event.type == EventType.PLAN_CREATED for event in events)
    assert any(event.type == EventType.LOOP_GUARD_NUDGE for event in events)
    assert planner.get_last_user_message() == "How should I approach learning Rust?"


@pytest.mark.asyncio
async def test_explicit_planner_allows_pure_clarification_question() -> None:
    events: list[Any] = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    planner = PlannerOrchestrator(
        claude_client=_RecordingSequenceClient(
            LLMResponse(
                text="Which repository should I inspect?",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )
        ),  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=emitter,
        sub_agent_manager=SimpleNamespace(cleanup=AsyncMock()),
        system_prompt="test",
    )

    result = await planner.run(
        "Please plan this vague task.",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "Which repository should I inspect?"
    assert not any(event.type == EventType.LOOP_GUARD_NUDGE for event in events)
    assert planner.get_last_user_message() == "Please plan this vague task."


@pytest.mark.asyncio
async def test_explicit_planner_does_not_exempt_refusal_like_inline_text() -> None:
    events: list[Any] = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    client = _RecordingSequenceClient(
        LLMResponse(
            text="I can't recommend a single framework, but here's a build plan.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-1",
                    name="plan_create",
                    input={
                        "steps": [
                            {
                                "name": "Frame answer",
                                "description": "Outline the response structure.",
                                "execution_type": "planner_owned",
                            }
                        ]
                    },
                ),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="Here is the structured answer.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=emitter,
        sub_agent_manager=SimpleNamespace(cleanup=AsyncMock()),
        system_prompt="test",
    )

    result = await planner.run(
        "What stack should I choose for a starter app?",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "Here is the structured answer."
    assert any(event.type == EventType.LOOP_GUARD_NUDGE for event in events)
    assert (
        planner.get_last_user_message()
        == "What stack should I choose for a starter app?"
    )


@pytest.mark.asyncio
async def test_explicit_planner_does_not_exempt_question_with_extra_instruction() -> (
    None
):
    events: list[Any] = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    client = _RecordingSequenceClient(
        LLMResponse(
            text="Which repository should I inspect? Please share the repo.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-1",
                    name="plan_create",
                    input={
                        "steps": [
                            {
                                "name": "Frame answer",
                                "description": "Outline the response structure.",
                                "execution_type": "planner_owned",
                            }
                        ]
                    },
                ),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="Here is the structured answer.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=emitter,
        sub_agent_manager=SimpleNamespace(cleanup=AsyncMock()),
        system_prompt="test",
    )

    result = await planner.run(
        "Which repository should I inspect?",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "Here is the structured answer."
    assert any(event.type == EventType.LOOP_GUARD_NUDGE for event in events)
    assert planner.get_last_user_message() == "Which repository should I inspect?"


@pytest.mark.asyncio
async def test_explicit_planner_actionable_turn_allows_plan_only_completion() -> None:
    events: list[Any] = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    class _WaitingManager:
        def __init__(self) -> None:
            self.cleanup = AsyncMock()

        async def spawn(self, config: Any) -> str:
            return "agent-1"

        async def wait(self, agent_ids=None, cancel_check=None):
            del agent_ids, cancel_check
            return {
                "agent-1": AgentResult(
                    agent_id="agent-1",
                    success=True,
                    summary="Research completed.",
                )
            }

    client = _RecordingSequenceClient(
        LLMResponse(
            text="I can handle this myself.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-1",
                    name="plan_create",
                    input={
                        "steps": [
                            {
                                "name": "Synthesize findings",
                                "description": "Create the report directly.",
                                "execution_type": "planner_owned",
                            },
                        ]
                    },
                ),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="Delegated work completed.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )
    manager = _WaitingManager()
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=emitter,
        sub_agent_manager=manager,
        system_prompt="test",
    )

    result = await planner.run(
        "Research current AI trends and write a summary report.",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "Delegated work completed."
    assert not any(event.type == EventType.AGENT_SPAWN for event in events)
    assert any(event.type == EventType.LOOP_GUARD_NUDGE for event in events)
    assert (
        planner.get_last_user_message()
        == "Research current AI trends and write a summary report."
    )


@pytest.mark.asyncio
async def test_explicit_planner_actionable_turn_requires_agent_wait_before_completion() -> (
    None
):
    events: list[Any] = []
    emitter = EventEmitter()
    captured_system_prompts: list[str] = []

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)

    class _WaitingManager:
        def __init__(self) -> None:
            self.cleanup = AsyncMock()

        async def spawn(self, config: Any) -> str:
            return "agent-1"

        async def wait(self, agent_ids=None, cancel_check=None):
            del agent_ids, cancel_check
            return {
                "agent-1": AgentResult(
                    agent_id="agent-1",
                    success=True,
                    summary="Research completed.",
                )
            }

    class _SystemRecordingClient(_RecordingSequenceClient):
        async def create_message_stream(self, **kwargs: Any) -> LLMResponse:
            captured_system_prompts.append(render_system_prompt(kwargs["system"]))
            return await super().create_message_stream(**kwargs)

    planner = PlannerOrchestrator(
        claude_client=_SystemRecordingClient(
            LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(
                        id="tool-1",
                        name="plan_create",
                        input={
                            "steps": [
                                {
                                    "name": "Research trends",
                                    "description": "Collect the current trend signals.",
                                    "execution_type": "parallel_worker",
                                }
                            ]
                        },
                    ),
                    ToolCall(
                        id="tool-2",
                        name="agent_spawn",
                        input={
                            "name": "Research trends",
                            "task_description": "Research the current AI trends.",
                            "deliverable": "A concise trend research summary.",
                            "ownership_scope": "Current AI trend research only.",
                            "independence_reason": "Research can run independently before planner synthesis.",
                        },
                    ),
                ),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            ),
            LLMResponse(
                text="Done without waiting.",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            ),
            LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(
                        id="tool-3",
                        name="agent_wait",
                        input={"agent_ids": ["agent-1"]},
                    ),
                ),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            ),
            LLMResponse(
                text="Delegated work completed.",
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            ),
        ),  # type: ignore[arg-type]
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=emitter,
        sub_agent_manager=_WaitingManager(),
        system_prompt="test",
    )

    result = await planner.run(
        "Research current AI trends and write a summary report.",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "Delegated work completed."
    assert any(event.type == EventType.LOOP_GUARD_NUDGE for event in events)
    assert any(
        "call agent_wait" in prompt.lower() for prompt in captured_system_prompts
    )


@pytest.mark.asyncio
async def test_orchestrator_cancel_does_not_return_stale_text_or_keep_cancelled_turn() -> (
    None
):
    started = asyncio.Event()
    release = asyncio.Event()
    client = _RecordingSequenceClient(
        LLMResponse(
            text="first answer",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="",
            tool_calls=(ToolCall(id="tool-1", name="blocker", input={}),),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="third answer",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
    )
    registry = ToolRegistry().register(_BlockingPlannerTool(started, release))
    orchestrator = AgentOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        system_prompt="test",
    )

    first = await orchestrator.run("first turn")
    run_task = asyncio.create_task(orchestrator.run("cancel me"))
    await started.wait()
    orchestrator.cancel()
    release.set()
    cancelled = await run_task
    third = await orchestrator.run("third turn")

    assert first == "first answer"
    assert cancelled == ""
    assert third == "third answer"
    assert orchestrator.get_last_user_message() == "third turn"
    third_call_text = str(client.message_history[-1])
    assert "cancel me" not in third_call_text
    assert "first turn" in third_call_text
    assert "third turn" in third_call_text


@pytest.mark.asyncio
async def test_orchestrator_skill_alias_triggers_mid_turn_skill_enforcement() -> None:
    client = _SequenceClient(
        LLMResponse(
            text="",
            tool_calls=(ToolCall(id="tool-1", name="deep-research", input={}),),
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
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_build_skill_registry()))
    )
    orchestrator = AgentOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await orchestrator.run("help me")

    assert client.tool_batches[0] == {
        "activate_skill",
        "demo_server__lookup_docs",
        "web_search",
    }
    assert client.tool_batches[1] == {"activate_skill", "web_search"}


@pytest.mark.asyncio
async def test_orchestrator_blocks_same_batch_tool_after_skill_activation() -> None:
    events = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    client = _SequenceClient(
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
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_build_skill_registry()))
    )
    orchestrator = AgentOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=emitter,
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    result = await orchestrator.run("help me")

    assert result == "done"
    blocked_result = next(
        event
        for event in events
        if event.type == EventType.TOOL_RESULT and event.data.get("tool_id") == "tool-2"
    )
    assert blocked_result.data["success"] is False
    assert "not allowed" in str(blocked_result.data["output"]).lower()


@pytest.mark.asyncio
async def test_orchestrator_mid_turn_skill_activation_preserves_runtime_prompt_sections(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "agent.runtime.orchestrator.get_settings",
        lambda: SimpleNamespace(
            COMPACT_FULL_INTERACTIONS=5,
            COMPACT_FULL_DIALOGUE_TURNS=5,
            COMPACT_TOKEN_BUDGET=150_000,
            COMPACT_SUMMARY_MODEL="",
            LITE_MODEL="claude-lite-test",
            SKILL_SELECTOR_MODEL="",
            PROMPT_CACHE_ENABLED=False,
            THINKING_BUDGET=0,
            VALIDATE_AGENT_MESSAGE_CHAIN=False,
            STUCK_LOOP_TOOL_REPEAT_THRESHOLD=0,
        ),
    )

    captured_system_prompts: list[str] = []

    class _PromptRecordingClient(_SequenceClient):
        async def create_message(self, **kwargs: Any) -> LLMResponse:
            return LLMResponse(
                text='{"skill": null}',
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )

        async def create_message_stream(self, **kwargs: Any) -> LLMResponse:
            captured_system_prompts.append(render_system_prompt(kwargs["system"]))
            return await super().create_message_stream(**kwargs)

    client = _PromptRecordingClient(
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
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(ActivateSkill(skill_registry=_build_skill_registry()))
    )
    orchestrator = AgentOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        system_prompt="base system",
        skill_registry=_build_skill_registry(),
    )

    result = await orchestrator.run(
        "help me",
        runtime_prompt_sections=(
            "<verified_user_facts>\n- timezone: Asia/Shanghai\n</verified_user_facts>",
        ),
    )

    assert result == "done"
    assert captured_system_prompts
    assert "<verified_user_facts>" in captured_system_prompts[0]
    assert "<verified_user_facts>" in captured_system_prompts[-1]
    assert '<skill_content name="deep-research">' in captured_system_prompts[-1]


@pytest.mark.asyncio
async def test_orchestrator_emits_cache_controls_on_stable_prompt_and_tools(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "agent.runtime.orchestrator.get_settings",
        lambda: SimpleNamespace(
            COMPACT_FULL_INTERACTIONS=5,
            COMPACT_FULL_DIALOGUE_TURNS=5,
            COMPACT_TOKEN_BUDGET=150_000,
            COMPACT_SUMMARY_MODEL="",
            LITE_MODEL="claude-lite-test",
            SKILL_SELECTOR_MODEL="",
            PROMPT_CACHE_ENABLED=True,
            THINKING_BUDGET=0,
            VALIDATE_AGENT_MESSAGE_CHAIN=False,
            STUCK_LOOP_TOOL_REPEAT_THRESHOLD=0,
        ),
    )

    captured_requests: list[dict[str, Any]] = []

    class _CacheRecordingClient(_SequenceClient):
        async def create_message(self, **kwargs: Any) -> LLMResponse:
            return LLMResponse(
                text='{"skill": null}',
                tool_calls=(),
                stop_reason="end_turn",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )

        async def create_message_stream(self, **kwargs: Any) -> LLMResponse:
            captured_requests.append(kwargs)
            return await super().create_message_stream(**kwargs)

    client = _CacheRecordingClient(
        LLMResponse(
            text="done",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )
    )
    registry = ToolRegistry().register(_FakeWebSearchTool())
    orchestrator = AgentOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        system_prompt="base system",
    )

    result = await orchestrator.run(
        "help me",
        runtime_prompt_sections=(
            "<verified_user_facts>\n- timezone: Asia/Shanghai\n</verified_user_facts>",
        ),
    )

    assert result == "done"
    assert captured_requests
    first = captured_requests[0]
    system_blocks = first["system"]
    assert isinstance(system_blocks, tuple)
    assert getattr(system_blocks[0].cache_control, "type", None) == "ephemeral"
    assert system_blocks[-1].text.startswith("<verified_user_facts>")
    assert system_blocks[-1].cache_control is None
    assert first["tools"][-1]["cache_control"] == {"type": "ephemeral"}


@pytest.mark.asyncio
async def test_planner_applies_mid_turn_skill_activation_constraints() -> None:
    client = _SequenceClient(
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
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_build_skill_registry()))
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        sub_agent_manager=AsyncMock(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await planner.run("help me plan")

    assert client.tool_batches[0] == {
        "activate_skill",
        "agent_spawn",
        "agent_wait",
        "demo_server__lookup_docs",
        "plan_create",
        "web_search",
    }
    assert client.tool_batches[1] == {
        "activate_skill",
        "agent_spawn",
        "agent_wait",
        "plan_create",
        "web_search",
    }


@pytest.mark.asyncio
async def test_explicit_planner_preserves_meta_tools_after_skill_activation() -> None:
    class _WaitingManager:
        def __init__(self) -> None:
            self.cleanup = AsyncMock()

        async def spawn(self, config: Any) -> str:
            del config
            return "agent-1"

        async def wait(self, agent_ids=None, cancel_check=None):
            del agent_ids, cancel_check
            return {
                "agent-1": AgentResult(
                    agent_id="agent-1",
                    success=True,
                    summary="Research completed.",
                )
            }

    client = _SequenceClient(
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
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-2",
                    name="plan_create",
                    input={
                        "steps": [
                            {
                                "name": "Research findings",
                                "description": "Collect the repo findings.",
                                "execution_type": "parallel_worker",
                            }
                        ]
                    },
                ),
                ToolCall(
                    id="tool-3",
                    name="agent_spawn",
                    input={
                        "name": "Research findings",
                        "task_description": "Research the repository findings.",
                        "deliverable": "A concise repository findings summary.",
                        "ownership_scope": "Repository research plan step only.",
                        "independence_reason": "Repository research can run independently before synthesis.",
                    },
                ),
            ),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        ),
        LLMResponse(
            text="",
            tool_calls=(
                ToolCall(
                    id="tool-4",
                    name="agent_wait",
                    input={"agent_ids": ["agent-1"]},
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
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_build_skill_registry()))
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        sub_agent_manager=_WaitingManager(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    result = await planner.run(
        "Research the repository and summarize the findings.",
        turn_metadata={"explicit_planner": True},
    )

    assert result == "done"
    assert client.tool_batches[1] == {
        "activate_skill",
        "agent_spawn",
        "agent_wait",
        "plan_create",
        "web_search",
    }


@pytest.mark.asyncio
async def test_planner_blocks_same_batch_tool_after_skill_activation() -> None:
    events = []
    emitter = EventEmitter()

    async def _capture(event: Any) -> None:
        events.append(event)

    emitter.subscribe(_capture)
    client = _SequenceClient(
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
    registry = (
        ToolRegistry()
        .register(_FakeWebSearchTool())
        .register(_FakeMCPTool())
        .register(ActivateSkill(skill_registry=_build_skill_registry()))
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=emitter,
        sub_agent_manager=AsyncMock(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    result = await planner.run("help me plan")

    assert result == "done"
    blocked_result = next(
        event
        for event in events
        if event.type == EventType.TOOL_RESULT and event.data.get("tool_id") == "tool-2"
    )
    assert blocked_result.data["success"] is False
    assert "not allowed" in str(blocked_result.data["output"]).lower()


@pytest.mark.asyncio
async def test_planner_builder_registry_keeps_skill_filtering_without_sandbox_tools(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "api.builders.get_settings",
        lambda: SimpleNamespace(
            TAVILY_API_KEY="test-key",
            SKILLS_ENABLED=True,
        ),
    )
    monkeypatch.setattr(
        "agent.runtime.planner.get_settings",
        lambda: SimpleNamespace(
            COMPACT_FULL_INTERACTIONS=5,
            COMPACT_FULL_DIALOGUE_TURNS=5,
            COMPACT_TOKEN_BUDGET=150_000,
            COMPACT_SUMMARY_MODEL="",
            PLANNING_MODEL="claude-test",
            LITE_MODEL="claude-lite-test",
            SKILL_SELECTOR_MODEL="",
        ),
    )

    client = _SequenceClient(
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
    registry = _build_planner_registry(
        event_emitter=EventEmitter(),
        on_complete=AsyncMock(),
        mcp_state=MCPState(clients={}),
        skill_registry=_build_skill_registry(),
    )
    planner = PlannerOrchestrator(
        claude_client=client,  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(registry=registry),
        event_emitter=EventEmitter(),
        sub_agent_manager=AsyncMock(),
        system_prompt="test",
        skill_registry=_build_skill_registry(),
    )

    await planner.run("help me plan")

    assert "shell_exec" not in client.tool_batches[0]
    assert "file_read" not in client.tool_batches[0]
    assert client.tool_batches[1] == {
        "activate_skill",
        "agent_spawn",
        "agent_wait",
        "plan_create",
        "task_complete",
        "user_message",
        "web_fetch",
        "web_search",
    }
