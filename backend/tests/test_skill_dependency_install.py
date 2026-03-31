"""Tests for skill dependency installation hardening."""

from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import MagicMock

import pytest

from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter


@dataclass
class _FakeExecResult:
    success: bool = True
    stdout: str = ""
    stderr: str = ""


@dataclass
class _FakeSession:
    commands: list[str] = field(default_factory=list)

    async def exec(self, command: str, timeout: int | None = None):
        self.commands.append(command)
        return _FakeExecResult()


@dataclass
class _FakeExecutor:
    session: _FakeSession

    async def get_sandbox_session(self):
        return self.session


@pytest.mark.asyncio
async def test_orchestrator_skips_unsafe_skill_dependencies() -> None:
    session = _FakeSession()
    orchestrator = AgentOrchestrator(
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=_FakeExecutor(session),  # type: ignore[arg-type]
        event_emitter=EventEmitter(),
        system_prompt="test",
    )

    await orchestrator._install_skill_dependencies(
        (
            "pip:pandas",
            "pip:bad;rm -rf /",
            "pip:--index-url=https://evil.example",
            "npm:@scope/pkg",
        )
    )

    assert session.commands == ["pip install pandas", "npm install @scope/pkg"]


@pytest.mark.asyncio
async def test_planner_skips_unsafe_skill_dependencies() -> None:
    session = _FakeSession()
    planner = PlannerOrchestrator(
        claude_client=MagicMock(),
        tool_registry=ToolRegistry(),
        tool_executor=ToolExecutor(registry=ToolRegistry()),
        event_emitter=EventEmitter(),
        sub_agent_manager=MagicMock(),
    )
    planner._executor = _FakeExecutor(session)  # type: ignore[assignment]

    await planner._install_skill_dependencies(
        ("pip:numpy", "npm:bad && whoami", "npm:--global", "npm:react")
    )

    assert session.commands == ["pip install numpy", "npm install react"]
