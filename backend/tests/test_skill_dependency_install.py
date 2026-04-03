"""Tests for skill dependency installation hardening."""

from __future__ import annotations

from dataclasses import dataclass, field
import pytest

from agent.runtime.skill_install import install_skill_dependencies_for_turn
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
    fake_exec = _FakeExecutor(session)
    await install_skill_dependencies_for_turn(
        fake_exec,  # type: ignore[arg-type]
        (
            "pip:pandas",
            "pip:bad;rm -rf /",
            "pip:--index-url=https://evil.example",
            "npm:@scope/pkg",
        ),
        EventEmitter(),
        context="test",
    )

    assert session.commands == ["pip install pandas", "npm install @scope/pkg"]


@pytest.mark.asyncio
async def test_planner_skips_unsafe_skill_dependencies() -> None:
    session = _FakeSession()
    planner_like = _FakeExecutor(session)

    await install_skill_dependencies_for_turn(
        planner_like,  # type: ignore[arg-type]
        ("pip:numpy", "npm:bad && whoami", "npm:--global", "npm:react"),
        EventEmitter(),
        context="test",
    )

    assert session.commands == ["pip install numpy", "npm install react"]
