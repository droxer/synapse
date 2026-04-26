from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TAVILY_API_KEY", "test-key")

from agent.artifacts.manager import ArtifactManager
from agent.llm.client import LLMResponse, TokenUsage, ToolCall
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.tools.executor import ToolExecutor
from agent.tools.local.markdown_artifact import CreateMarkdownArtifact
from agent.tools.registry import ToolRegistry
from api.builders import (
    RESULT_DELIVERY_PROMPT_SECTION,
    _build_planner_registry,
    build_default_agent_system_prompt_sections,
)
from api.events import AgentEvent, EventEmitter, EventType
from api.models import MCPState


REPORT_CONTENT = "\n".join(
    [
        "# Implementation Review Report",
        "",
        "## Findings",
        "",
        "- Fuller planner responses are preserved.",
        "- Markdown artifacts are visible in quick view.",
    ]
)


class _ArtifactChoosingClient:
    default_model = "test-model"

    def __init__(self) -> None:
        self.calls = 0

    async def create_message_stream(self, **kwargs):
        self.calls += 1
        if self.calls == 1:
            return LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(
                        id="tool-1",
                        name="create_markdown_artifact",
                        input={
                            "title": "Implementation Review Report",
                            "filename": "implementation-review-report.md",
                            "content": REPORT_CONTENT,
                        },
                    ),
                ),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=1, output_tokens=1),
            )
        return LLMResponse(
            text="Created a Markdown report and added it to artifacts.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _TextChoosingClient:
    default_model = "test-model"

    async def create_message_stream(self, **kwargs):
        return LLMResponse(
            text="Done.",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
        )


class _NoopObserver:
    def should_compact(self, messages, system_prompt="") -> bool:
        return False

    async def compact(self, messages, system_prompt=""):
        return messages


async def _record_events(emitter: EventEmitter) -> list[AgentEvent]:
    events: list[AgentEvent] = []

    async def subscriber(event: AgentEvent) -> None:
        events.append(event)

    emitter.subscribe(subscriber)
    return events


def _registry_with_markdown_tool(
    *,
    artifact_manager: ArtifactManager,
    emitter: EventEmitter,
) -> ToolRegistry:
    return ToolRegistry().register(
        CreateMarkdownArtifact(
            artifact_manager=artifact_manager,
            event_emitter=emitter,
        )
    )


@pytest.mark.asyncio
async def test_create_markdown_artifact_tool_emits_user_visible_artifact(
    tmp_path: Path,
) -> None:
    artifact_manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))
    emitter = EventEmitter()
    events = await _record_events(emitter)
    tool = CreateMarkdownArtifact(
        artifact_manager=artifact_manager,
        event_emitter=emitter,
    )

    result = await tool.execute(
        title="Implementation Review Report",
        filename="implementation-review-report.md",
        content=REPORT_CONTENT,
    )

    artifact_id = list(result.metadata["artifact_ids"])[0]  # type: ignore[index]
    artifact = artifact_manager.get_artifact(artifact_id)
    artifact_events = [
        event for event in events if event.type == EventType.ARTIFACT_CREATED
    ]

    assert result.success is True
    assert artifact is not None
    assert artifact.original_name == "implementation-review-report.md"
    assert artifact.content_type == "text/markdown"
    assert Path(artifact_manager.get_path(artifact)).read_text() == REPORT_CONTENT
    assert artifact_events[0].data["artifact_id"] == artifact_id


@pytest.mark.asyncio
async def test_single_agent_only_returns_artifact_when_model_chooses_tool(
    tmp_path: Path,
) -> None:
    artifact_manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))
    emitter = EventEmitter()
    events = await _record_events(emitter)
    registry = _registry_with_markdown_tool(
        artifact_manager=artifact_manager,
        emitter=emitter,
    )
    orchestrator = AgentOrchestrator(
        claude_client=_ArtifactChoosingClient(),  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(
            registry=registry,
            event_emitter=emitter,
            artifact_manager=artifact_manager,
        ),
        event_emitter=emitter,
        system_prompt="test",
        observer=_NoopObserver(),  # type: ignore[arg-type]
    )

    result = await orchestrator.run("write a report")

    artifact_events = [
        event for event in events if event.type == EventType.ARTIFACT_CREATED
    ]
    turn_complete = [
        event for event in events if event.type == EventType.TURN_COMPLETE
    ][-1]

    assert result == "Created a Markdown report and added it to artifacts."
    assert len(artifact_events) == 1
    assert turn_complete.data["artifact_ids"] == [
        artifact_events[0].data["artifact_id"]
    ]


@pytest.mark.asyncio
async def test_single_agent_plain_text_choice_does_not_create_artifact(
    tmp_path: Path,
) -> None:
    artifact_manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))
    emitter = EventEmitter()
    events = await _record_events(emitter)
    registry = _registry_with_markdown_tool(
        artifact_manager=artifact_manager,
        emitter=emitter,
    )
    orchestrator = AgentOrchestrator(
        claude_client=_TextChoosingClient(),  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(
            registry=registry,
            event_emitter=emitter,
            artifact_manager=artifact_manager,
        ),
        event_emitter=emitter,
        system_prompt="test",
        observer=_NoopObserver(),  # type: ignore[arg-type]
    )

    await orchestrator.run("quick answer")

    assert [event for event in events if event.type == EventType.ARTIFACT_CREATED] == []
    turn_complete = [
        event for event in events if event.type == EventType.TURN_COMPLETE
    ][-1]
    assert turn_complete.data["artifact_ids"] == []


@pytest.mark.asyncio
async def test_planner_can_choose_markdown_artifact_tool(tmp_path: Path) -> None:
    artifact_manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))
    emitter = EventEmitter()
    events = await _record_events(emitter)
    registry = _registry_with_markdown_tool(
        artifact_manager=artifact_manager,
        emitter=emitter,
    )
    planner = PlannerOrchestrator(
        claude_client=_ArtifactChoosingClient(),  # type: ignore[arg-type]
        tool_registry=registry,
        tool_executor=ToolExecutor(
            registry=registry,
            event_emitter=emitter,
            artifact_manager=artifact_manager,
        ),
        event_emitter=emitter,
        sub_agent_manager=AsyncMock(),
        observer=_NoopObserver(),  # type: ignore[arg-type]
        system_prompt="planner test",
    )

    await planner.run("write a report")

    artifact_events = [
        event for event in events if event.type == EventType.ARTIFACT_CREATED
    ]
    turn_complete = [
        event for event in events if event.type == EventType.TURN_COMPLETE
    ][-1]

    assert len(artifact_events) == 1
    assert turn_complete.data["artifact_ids"] == [
        artifact_events[0].data["artifact_id"]
    ]


def test_prompt_policy_and_planner_registry_expose_agent_choice(tmp_path: Path) -> None:
    artifact_manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))
    emitter = EventEmitter()

    sections = build_default_agent_system_prompt_sections(None, None)
    assert any(RESULT_DELIVERY_PROMPT_SECTION in section.text for section in sections)

    registry = _build_planner_registry(
        event_emitter=emitter,
        on_complete=AsyncMock(),
        mcp_state=MCPState(),
        artifact_manager=artifact_manager,
    )
    assert registry.get("create_markdown_artifact") is not None
