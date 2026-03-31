"""Tests for Phase 2: E2B session enhancements (mocked E2B SDK)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.sandbox.base import (
    CodeResult,
    ExecResult,
    ExtendedSandboxSession,
)
from agent.sandbox.e2b_provider import E2BProvider, E2BSession, _infer_display_type


@dataclass
class _FakeExecResult:
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


@dataclass
class _FakeResultItem:
    raw: dict


@dataclass
class _FakeExecution:
    stdout: str = ""
    stderr: str = ""
    error: Any = None
    results: list = None

    def __post_init__(self) -> None:
        if self.results is None:
            self.results = []


class _FakeCommands:
    def __init__(self) -> None:
        self.last_kwargs: dict[str, Any] = {}

    def run(self, command: str, **kwargs: Any) -> _FakeExecResult:
        self.last_kwargs = kwargs
        if "on_stdout" in kwargs:
            kwargs["on_stdout"](MagicMock(line="hello"))
        if "on_stderr" in kwargs:
            kwargs["on_stderr"](MagicMock(line="warn"))
        return _FakeExecResult(stdout="hello", stderr="warn", exit_code=0)


class _FakeSandbox:
    def __init__(self) -> None:
        self.sandbox_id = "sbx-test-123"
        self.commands = _FakeCommands()
        self._paused = False
        self._killed = False

    def run_code(self, code: str, language: str = "python") -> _FakeExecution:
        return _FakeExecution(
            stdout="42",
            stderr="",
            results=[
                _FakeResultItem(raw={"text/plain": "42"}),
                _FakeResultItem(raw={"image/png": "iVBOR..."}),
            ],
        )

    def pause(self) -> None:
        self._paused = True

    def kill(self) -> None:
        self._killed = True


class TestSandboxIdProperty:
    def test_returns_id(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        assert session.sandbox_id == "sbx-test-123"

    def test_returns_none_when_missing(self) -> None:
        sandbox = MagicMock(spec=[])
        session = E2BSession(sandbox=sandbox)
        assert session.sandbox_id is None


class TestRunCode:
    @pytest.mark.asyncio
    async def test_successful_execution(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        result = await session.run_code("print(42)")

        assert isinstance(result, CodeResult)
        assert result.stdout == "42"
        assert result.error is None
        assert len(result.results) == 2
        assert result.results[0].mime_type == "text/plain"
        assert result.results[1].mime_type == "image/png"
        assert result.results[1].display_type == "image"

    @pytest.mark.asyncio
    async def test_execution_error(self) -> None:
        sandbox = MagicMock()
        sandbox.run_code.side_effect = RuntimeError("E2B down")
        session = E2BSession(sandbox=sandbox)
        result = await session.run_code("bad code")

        assert result.error is not None
        assert "E2B down" in result.stderr


class TestExecStream:
    @pytest.mark.asyncio
    async def test_callbacks_invoked(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        result = await session.exec_stream(
            "echo hello",
            on_stdout=stdout_lines.append,
            on_stderr=stderr_lines.append,
        )

        assert isinstance(result, ExecResult)
        assert result.exit_code == 0
        assert "hello" in stdout_lines
        assert "warn" in stderr_lines

    @pytest.mark.asyncio
    async def test_without_callbacks(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        result = await session.exec_stream("ls")
        assert result.exit_code == 0


class TestCloseAndKill:
    @pytest.mark.asyncio
    async def test_close_pauses(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        await session.close()
        assert sandbox._paused

    @pytest.mark.asyncio
    async def test_kill_kills(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        await session.kill()
        assert sandbox._killed


class TestProviderDestroySession:
    @pytest.mark.asyncio
    async def test_destroy_session_releases_to_pool_when_configured(self) -> None:
        pool = AsyncMock()
        provider = E2BProvider(api_key="test-key", pool=pool)
        session = E2BSession(sandbox=_FakeSandbox())

        await provider.destroy_session(session)

        pool.release.assert_awaited_once_with(session)

    @pytest.mark.asyncio
    async def test_destroy_session_kills_non_pooled_e2b_session(self) -> None:
        provider = E2BProvider(api_key="test-key")
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)

        await provider.destroy_session(session)

        assert sandbox._killed
        assert not sandbox._paused


class TestInferDisplayType:
    def test_image(self) -> None:
        assert _infer_display_type("image/png") == "image"
        assert _infer_display_type("image/jpeg") == "image"

    def test_dataframe(self) -> None:
        assert _infer_display_type("text/html") == "dataframe"
        assert _infer_display_type("application/json") == "dataframe"

    def test_chart(self) -> None:
        assert _infer_display_type("application/vnd.plotly.v1+json") == "chart"

    def test_text_fallback(self) -> None:
        assert _infer_display_type("text/plain") == "text"
        assert _infer_display_type("application/xml") == "text"


class TestExtendedProtocol:
    def test_e2b_session_is_extended(self) -> None:
        sandbox = _FakeSandbox()
        session = E2BSession(sandbox=sandbox)
        assert isinstance(session, ExtendedSandboxSession)
