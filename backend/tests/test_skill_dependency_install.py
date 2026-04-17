"""Tests for skill dependency installation hardening."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from agent.runtime.skill_install import install_skill_dependencies_for_turn
from api.events import EventEmitter, EventType


@dataclass
class _FakeExecResult:
    success: bool = True
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


@dataclass
class _FakeSession:
    commands: list[str] = field(default_factory=list)
    results: list[_FakeExecResult] = field(default_factory=list)

    async def exec(self, command: str, timeout: int | None = None):
        self.commands.append(command)
        if self.results:
            return self.results.pop(0)
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

    assert session.commands == [
        "pip install pandas",
        "pwd",
        "df -Pk . /tmp 2>/dev/null || true",
        "npm config get cache 2>/dev/null || true",
        "npm install @scope/pkg",
    ]


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

    assert session.commands == [
        "pip install numpy",
        "pwd",
        "df -Pk . /tmp 2>/dev/null || true",
        "npm config get cache 2>/dev/null || true",
        "npm install react",
    ]


@pytest.mark.asyncio
async def test_npm_enospc_retries_once_and_succeeds() -> None:
    session = _FakeSession(
        results=[
            _FakeExecResult(stdout="/home/user\n"),
            _FakeExecResult(
                stdout=(
                    "Filesystem 1024-blocks Used Available Capacity Mounted on\n"
                    "/dev/root 100 50 50 50% /\n"
                )
            ),
            _FakeExecResult(stdout="/home/user/.npm\n"),
            _FakeExecResult(stdout="12M\t/home/user/.npm\n"),
            _FakeExecResult(
                success=False,
                stderr="npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write",
                exit_code=228,
            ),
            _FakeExecResult(stdout="cache cleaned"),
            _FakeExecResult(),
            _FakeExecResult(success=True, stdout="installed"),
            _FakeExecResult(stdout="/home/user\n"),
            _FakeExecResult(
                stdout=(
                    "Filesystem 1024-blocks Used Available Capacity Mounted on\n"
                    "/dev/root 100 25 75 25% /\n"
                )
            ),
            _FakeExecResult(stdout="/home/user/.npm\n"),
            _FakeExecResult(stdout="3M\t/home/user/.npm\n"),
        ]
    )

    await install_skill_dependencies_for_turn(
        _FakeExecutor(session),  # type: ignore[arg-type]
        ("npm:react",),
        EventEmitter(),
        context="test",
    )

    assert session.commands == [
        "pwd",
        "df -Pk . /tmp 2>/dev/null || true",
        "npm config get cache 2>/dev/null || true",
        "du -sh /home/user/.npm 2>/dev/null || true",
        "npm install react",
        "npm cache clean --force",
        "sh -lc 'rm -rf /tmp/npm-* /tmp/.npm-* /tmp/package-*'",
        "npm install react",
        "pwd",
        "df -Pk . /tmp 2>/dev/null || true",
        "npm config get cache 2>/dev/null || true",
        "du -sh /home/user/.npm 2>/dev/null || true",
    ]


@pytest.mark.asyncio
async def test_npm_enospc_emits_structured_failure_after_retry() -> None:
    session = _FakeSession(
        results=[
            _FakeExecResult(stdout="/home/user\n"),
            _FakeExecResult(stdout="Filesystem ...\n/dev/root 100 50 50 50% /\n"),
            _FakeExecResult(stdout="/home/user/.npm\n"),
            _FakeExecResult(stdout="12M\t/home/user/.npm\n"),
            _FakeExecResult(
                success=False,
                stderr="npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write",
                exit_code=228,
            ),
            _FakeExecResult(stdout="cache cleaned"),
            _FakeExecResult(),
            _FakeExecResult(
                success=False,
                stderr="npm error ENOSPC no space left on device",
                exit_code=228,
            ),
            _FakeExecResult(stdout="/home/user\n"),
            _FakeExecResult(stdout="Filesystem ...\n/dev/root 100 90 10 90% /\n"),
            _FakeExecResult(stdout="/home/user/.npm\n"),
            _FakeExecResult(stdout="9M\t/home/user/.npm\n"),
        ]
    )
    emitter = EventEmitter()
    events: list[tuple[EventType, dict[str, object]]] = []

    async def _collect(event) -> None:
        events.append((event.type, event.data))

    emitter.subscribe(_collect)

    await install_skill_dependencies_for_turn(
        _FakeExecutor(session),  # type: ignore[arg-type]
        ("npm:react",),
        emitter,
        context="test",
        skill_name="frontend-design",
        source="auto",
    )

    dependency_failures = [
        data
        for event_type, data in events
        if event_type == EventType.SKILL_DEPENDENCY_FAILED
    ]
    assert len(dependency_failures) == 1
    assert dependency_failures[0]["error_code"] == "npm_enospc"
    assert dependency_failures[0]["retry_attempted"] is True
    assert "df:" in str(dependency_failures[0]["diagnostics"])
    assert "npm_enospc" in str(dependency_failures[0]["error"])

    setup_failures = [
        data
        for event_type, data in events
        if event_type == EventType.SKILL_SETUP_FAILED
    ]
    assert len(setup_failures) == 1
    assert setup_failures[0]["error_code"] == "npm_enospc"
    assert setup_failures[0]["retry_attempted"] is True


@pytest.mark.asyncio
async def test_non_enospc_npm_failure_does_not_retry() -> None:
    session = _FakeSession(
        results=[
            _FakeExecResult(stdout="/home/user\n"),
            _FakeExecResult(stdout="Filesystem ...\n/dev/root 100 50 50 50% /\n"),
            _FakeExecResult(stdout="/home/user/.npm\n"),
            _FakeExecResult(stdout="12M\t/home/user/.npm\n"),
            _FakeExecResult(
                success=False,
                stderr="npm error code E404\nnpm error 404 Not Found",
                exit_code=1,
            ),
        ]
    )
    emitter = EventEmitter()
    events: list[tuple[EventType, dict[str, object]]] = []

    async def _collect(event) -> None:
        events.append((event.type, event.data))

    emitter.subscribe(_collect)

    await install_skill_dependencies_for_turn(
        _FakeExecutor(session),  # type: ignore[arg-type]
        ("npm:missing-package",),
        emitter,
        context="test",
        skill_name="frontend-design",
        source="auto",
    )

    assert session.commands == [
        "pwd",
        "df -Pk . /tmp 2>/dev/null || true",
        "npm config get cache 2>/dev/null || true",
        "du -sh /home/user/.npm 2>/dev/null || true",
        "npm install missing-package",
    ]
    dependency_failures = [
        data
        for event_type, data in events
        if event_type == EventType.SKILL_DEPENDENCY_FAILED
    ]
    assert len(dependency_failures) == 1
    assert dependency_failures[0]["error_code"] is None
    assert dependency_failures[0]["retry_attempted"] is False
