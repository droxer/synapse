"""Tests for the sandbox package_install tool."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from agent.tools.sandbox.package_install import PackageInstall


@dataclass
class _FakeExecResult:
    success: bool = True
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


@dataclass
class _FakeSession:
    results: list[_FakeExecResult] = field(default_factory=list)
    commands: list[str] = field(default_factory=list)

    async def exec(self, command: str, timeout: int | None = None):
        self.commands.append(command)
        if self.results:
            return self.results.pop(0)
        return _FakeExecResult()


@pytest.mark.asyncio
async def test_package_install_reports_normalized_npm_enospc_error() -> None:
    tool = PackageInstall()
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

    result = await tool.execute(session=session, packages="react", manager="npm")

    assert result.success is False
    assert result.error is not None
    assert "npm_enospc" in result.error
    assert "retry_attempted=true" in result.error
    assert result.metadata is not None
    assert result.metadata["error_code"] == "npm_enospc"
    assert result.metadata["retry_attempted"] is True


@pytest.mark.asyncio
async def test_package_install_does_not_apply_npm_retry_logic_to_pip() -> None:
    tool = PackageInstall()
    session = _FakeSession(
        results=[
            _FakeExecResult(
                success=False,
                stderr="pip failed for unrelated reason",
                exit_code=1,
            )
        ]
    )

    result = await tool.execute(session=session, packages="pandas", manager="pip")

    assert result.success is False
    assert session.commands == ["pip install pandas"]
    assert result.metadata is not None
    assert result.metadata["error_code"] is None
    assert result.metadata["retry_attempted"] is False
