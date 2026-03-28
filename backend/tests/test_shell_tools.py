"""Tests for interactive shell session tools and shell_exec background mode."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from agent.tools.sandbox.shell_tools import (
    ShellKill,
    ShellView,
    ShellWait,
    ShellWrite,
    _ALLOWED_SIGNALS,
    _validate_session_id,
)
from agent.tools.sandbox.shell_exec import ShellExec


# ------------------------------------------------------------------
# Mock sandbox session
# ------------------------------------------------------------------


@dataclass
class ExecResult:
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0

    @property
    def success(self) -> bool:
        return self.exit_code == 0


class MockSession:
    """Lightweight mock for SandboxSession used by shell tools."""

    def __init__(self, exec_responses: dict[str, ExecResult] | None = None) -> None:
        self._responses = exec_responses or {}
        self._default = ExecResult()
        self.exec_calls: list[dict[str, Any]] = []

    def set_default(self, result: ExecResult) -> None:
        self._default = result

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        self.exec_calls.append(
            {"command": command, "timeout": timeout, "workdir": workdir}
        )
        # Match by substring for flexible stubbing
        for pattern, result in self._responses.items():
            if pattern in command:
                return result
        return self._default

    async def write_file(self, path: str, content: str) -> None:
        pass

    async def exec_stream(self, *args: Any, **kwargs: Any) -> ExecResult:
        return await self.exec(args[0] if args else "", **kwargs)


# ------------------------------------------------------------------
# Session ID validation
# ------------------------------------------------------------------


class TestValidateSessionId:
    def test_valid_alphanumeric(self) -> None:
        assert _validate_session_id("my-server") == "my-server"

    def test_valid_underscores(self) -> None:
        assert _validate_session_id("dev_server_1") == "dev_server_1"

    def test_valid_with_whitespace_stripped(self) -> None:
        assert _validate_session_id("  server  ") == "server"

    def test_empty_string(self) -> None:
        assert _validate_session_id("") is None

    def test_path_traversal(self) -> None:
        assert _validate_session_id("../etc/passwd") is None

    def test_shell_injection(self) -> None:
        assert _validate_session_id("foo; rm -rf /") is None

    def test_spaces_in_name(self) -> None:
        assert _validate_session_id("my server") is None

    def test_too_long(self) -> None:
        assert _validate_session_id("a" * 65) is None

    def test_max_length(self) -> None:
        assert _validate_session_id("a" * 64) == "a" * 64

    def test_special_characters(self) -> None:
        assert _validate_session_id("foo$bar") is None
        assert _validate_session_id("foo`bar`") is None
        assert _validate_session_id("foo|bar") is None


# ------------------------------------------------------------------
# ShellView
# ------------------------------------------------------------------


class TestShellView:
    def test_definition(self) -> None:
        tool = ShellView()
        defn = tool.definition()
        assert defn.name == "shell_view"
        assert "id" in defn.input_schema["properties"]

    @pytest.mark.asyncio
    async def test_invalid_session_id(self) -> None:
        tool = ShellView()
        result = await tool.execute(session=MockSession(), id="../bad")
        assert not result.success
        assert "Invalid session id" in (result.error or "")

    @pytest.mark.asyncio
    async def test_empty_session_id(self) -> None:
        tool = ShellView()
        result = await tool.execute(session=MockSession(), id="")
        assert not result.success

    @pytest.mark.asyncio
    async def test_session_not_found(self) -> None:
        session = MockSession({"test -d": ExecResult(exit_code=1)})
        tool = ShellView()
        result = await tool.execute(session=session, id="nonexistent")
        assert not result.success
        assert "not found" in (result.error or "")

    @pytest.mark.asyncio
    async def test_session_found_running(self) -> None:
        session = MockSession(
            {
                "test -d": ExecResult(exit_code=0),
                "=== stdout ===": ExecResult(
                    stdout="=== stdout ===\nhello world\n\n=== stderr ===\n"
                ),
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=0),
            }
        )
        tool = ShellView()
        result = await tool.execute(session=session, id="my-server")
        assert result.success
        assert "running" in result.output
        assert (result.metadata or {}).get("status") == "running"

    @pytest.mark.asyncio
    async def test_session_found_exited(self) -> None:
        session = MockSession(
            {
                "test -d": ExecResult(exit_code=0),
                "=== stdout ===": ExecResult(stdout="output here"),
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=1),
            }
        )
        tool = ShellView()
        result = await tool.execute(session=session, id="my-server")
        assert result.success
        assert "exited" in result.output


# ------------------------------------------------------------------
# ShellWait
# ------------------------------------------------------------------


class TestShellWait:
    def test_definition(self) -> None:
        tool = ShellWait()
        defn = tool.definition()
        assert defn.name == "shell_wait"

    @pytest.mark.asyncio
    async def test_invalid_session_id(self) -> None:
        tool = ShellWait()
        result = await tool.execute(session=MockSession(), id="bad/id")
        assert not result.success

    @pytest.mark.asyncio
    async def test_session_not_found(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(exit_code=1, stdout=""),
            }
        )
        tool = ShellWait()
        result = await tool.execute(session=session, id="missing")
        assert not result.success
        assert "not found" in (result.error or "")

    @pytest.mark.asyncio
    async def test_process_exited(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "ELAPSED": ExecResult(stdout="EXITED"),
                "tail -n 50": ExecResult(stdout="final output"),
                "tail -n 20": ExecResult(stdout=""),
                "/exit_code": ExecResult(stdout="0"),
            }
        )
        tool = ShellWait()
        result = await tool.execute(session=session, id="server", timeout=5)
        assert result.success
        assert "exited with code 0" in result.output

    @pytest.mark.asyncio
    async def test_process_timed_out(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "ELAPSED": ExecResult(stdout="TIMEOUT"),
                "tail -n 50": ExecResult(stdout="partial output"),
                "tail -n 20": ExecResult(stdout=""),
            }
        )
        tool = ShellWait()
        result = await tool.execute(session=session, id="server", timeout=5)
        assert result.success
        assert "timed out" in result.output
        assert (result.metadata or {}).get("timed_out") is True

    @pytest.mark.asyncio
    async def test_nonzero_exit_code(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "ELAPSED": ExecResult(stdout="EXITED"),
                "tail -n 50": ExecResult(stdout="error output"),
                "tail -n 20": ExecResult(stdout="some error"),
                "/exit_code": ExecResult(stdout="1"),
            }
        )
        tool = ShellWait()
        result = await tool.execute(session=session, id="server", timeout=5)
        assert result.success
        assert "exited with code 1" in result.output
        assert (result.metadata or {}).get("exit_code") == 1


# ------------------------------------------------------------------
# ShellWrite
# ------------------------------------------------------------------


class TestShellWrite:
    def test_definition(self) -> None:
        tool = ShellWrite()
        defn = tool.definition()
        assert defn.name == "shell_write"
        assert "input" in defn.input_schema["required"]

    @pytest.mark.asyncio
    async def test_invalid_session_id(self) -> None:
        tool = ShellWrite()
        result = await tool.execute(session=MockSession(), id="$bad", input="hello")
        assert not result.success

    @pytest.mark.asyncio
    async def test_session_not_found(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(exit_code=1, stdout=""),
            }
        )
        tool = ShellWrite()
        result = await tool.execute(session=session, id="missing", input="data")
        assert not result.success
        assert "not found" in (result.error or "")

    @pytest.mark.asyncio
    async def test_process_not_running(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=1),
            }
        )
        tool = ShellWrite()
        result = await tool.execute(session=session, id="server", input="data")
        assert not result.success
        assert "no longer running" in (result.error or "")

    @pytest.mark.asyncio
    async def test_write_success(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=0),
                "echo": ExecResult(exit_code=0),
            }
        )
        tool = ShellWrite()
        result = await tool.execute(session=session, id="server", input="hello")
        assert result.success
        assert "Sent input" in result.output

    @pytest.mark.asyncio
    async def test_write_failure(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=0),
                "echo": ExecResult(exit_code=1, stderr="broken pipe"),
            }
        )
        tool = ShellWrite()
        result = await tool.execute(session=session, id="server", input="hello")
        assert not result.success
        assert "Failed to write" in (result.error or "")


# ------------------------------------------------------------------
# ShellKill
# ------------------------------------------------------------------


class TestShellKill:
    def test_definition(self) -> None:
        tool = ShellKill()
        defn = tool.definition()
        assert defn.name == "shell_kill"

    @pytest.mark.asyncio
    async def test_invalid_session_id(self) -> None:
        tool = ShellKill()
        result = await tool.execute(session=MockSession(), id="../../etc")
        assert not result.success

    @pytest.mark.asyncio
    async def test_invalid_signal(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=0),
            }
        )
        tool = ShellKill()
        result = await tool.execute(session=session, id="server", signal="SEGV")
        assert not result.success
        assert "Invalid signal" in (result.error or "")

    @pytest.mark.asyncio
    async def test_all_allowed_signals(self) -> None:
        for sig in _ALLOWED_SIGNALS:
            session = MockSession(
                {
                    "/pid": ExecResult(stdout="1234"),
                    "kill -0": ExecResult(exit_code=0),
                    f"kill -{sig}": ExecResult(exit_code=0),
                }
            )
            tool = ShellKill()
            result = await tool.execute(session=session, id="server", signal=sig)
            assert result.success, f"Signal {sig} should be allowed"

    @pytest.mark.asyncio
    async def test_session_not_found(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(exit_code=1, stdout=""),
            }
        )
        tool = ShellKill()
        result = await tool.execute(session=session, id="missing")
        assert not result.success

    @pytest.mark.asyncio
    async def test_already_exited(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=1),
            }
        )
        tool = ShellKill()
        result = await tool.execute(session=session, id="server")
        assert result.success
        assert "already exited" in result.output

    @pytest.mark.asyncio
    async def test_kill_success(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=0),
                "kill -TERM": ExecResult(exit_code=0),
            }
        )
        tool = ShellKill()
        result = await tool.execute(session=session, id="server")
        assert result.success
        assert "SIGTERM" in result.output

    @pytest.mark.asyncio
    async def test_kill_failure(self) -> None:
        session = MockSession(
            {
                "/pid": ExecResult(stdout="1234"),
                "kill -0": ExecResult(exit_code=0),
                "kill -KILL": ExecResult(exit_code=1, stderr="Operation not permitted"),
            }
        )
        tool = ShellKill()
        result = await tool.execute(session=session, id="server", signal="KILL")
        assert not result.success


# ------------------------------------------------------------------
# ShellExec background mode
# ------------------------------------------------------------------


class TestShellExecBackground:
    def test_definition_has_id_param(self) -> None:
        tool = ShellExec()
        defn = tool.definition()
        assert "id" in defn.input_schema["properties"]

    @pytest.mark.asyncio
    async def test_invalid_session_id(self) -> None:
        tool = ShellExec()
        result = await tool.execute(
            session=MockSession(), command="echo hi", id="../bad"
        )
        assert not result.success
        assert "Invalid session id" in (result.error or "")

    @pytest.mark.asyncio
    async def test_background_start_success(self) -> None:
        session = MockSession(
            {
                "nohup": ExecResult(stdout="5678", exit_code=0),
            }
        )
        tool = ShellExec()
        result = await tool.execute(
            session=session, command="npm start", id="dev-server"
        )
        assert result.success
        assert "5678" in result.output
        assert "dev-server" in result.output
        assert (result.metadata or {}).get("session_id") == "dev-server"

    @pytest.mark.asyncio
    async def test_background_start_failure(self) -> None:
        session = MockSession(
            {
                "nohup": ExecResult(stdout="", exit_code=1, stderr="permission denied"),
            }
        )
        tool = ShellExec()
        result = await tool.execute(session=session, command="npm start", id="server")
        assert not result.success

    @pytest.mark.asyncio
    async def test_regular_exec_unaffected(self) -> None:
        """shell_exec without id should still work normally."""
        session = MockSession()
        session.set_default(ExecResult(stdout="hello", exit_code=0))
        tool = ShellExec()
        result = await tool.execute(session=session, command="echo hello")
        assert result.success
        assert result.output == "hello"

    @pytest.mark.asyncio
    async def test_empty_command(self) -> None:
        tool = ShellExec()
        result = await tool.execute(session=MockSession(), command="")
        assert not result.success
        assert "must not be empty" in (result.error or "")
