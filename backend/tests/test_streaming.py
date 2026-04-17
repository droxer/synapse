"""Tests for Phase 5: Streaming output."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.sandbox.base import ExecResult
from agent.tools.sandbox.shell_exec import ShellExec, _make_stream_callbacks
from agent.tools.sandbox.code_run import CodeRun
from api.events import EventEmitter, EventType


class TestMakeStreamCallbacks:
    @pytest.mark.asyncio
    async def test_callbacks_emit_events(self) -> None:
        emitter = EventEmitter()
        events: list[tuple[str, str]] = []

        async def subscriber(event):
            events.append((event.type.value, event.data.get("text", "")))

        emitter.subscribe(subscriber)
        on_stdout, on_stderr = _make_stream_callbacks(emitter)

        on_stdout("hello")
        on_stderr("warning")

        # Allow coroutines to complete
        await asyncio.sleep(0.1)

        assert ("sandbox_stdout", "hello") in events
        assert ("sandbox_stderr", "warning") in events


class TestShellExecStreaming:
    @pytest.mark.asyncio
    async def test_uses_exec_stream_when_available(self) -> None:
        tool = ShellExec()
        emitter = EventEmitter()

        session = MagicMock()
        session.exec_stream = AsyncMock(
            return_value=ExecResult(stdout="streamed", stderr="", exit_code=0)
        )
        # Make it pass isinstance check for ExtendedSandboxSession
        session.exec = AsyncMock()
        session.read_file = AsyncMock()
        session.write_file = AsyncMock()
        session.upload_file = AsyncMock()
        session.download_file = AsyncMock()
        session.close = AsyncMock()
        session.run_code = AsyncMock()
        session.sandbox_id = "test"

        result = await tool.execute(
            session=session, command="ls", event_emitter=emitter
        )

        assert result.success
        assert result.output == "streamed"
        session.exec_stream.assert_called_once()

    @pytest.mark.asyncio
    async def test_falls_back_to_exec_without_emitter(self) -> None:
        tool = ShellExec()

        session = MagicMock()
        session.exec = AsyncMock(
            return_value=ExecResult(stdout="normal", stderr="", exit_code=0)
        )

        result = await tool.execute(session=session, command="ls")

        assert result.success
        assert result.output == "normal"
        session.exec.assert_any_call("ls", timeout=30, workdir=None)


class TestCodeRunStreaming:
    @pytest.mark.asyncio
    async def test_uses_exec_stream_when_available(self) -> None:
        tool = CodeRun()
        emitter = EventEmitter()

        session = MagicMock()
        session.write_file = AsyncMock()
        session.exec_stream = AsyncMock(
            return_value=ExecResult(stdout="42", stderr="", exit_code=0)
        )
        # exec is used for the timestamp marker, find command, and cleanup —
        # return a no-op ExecResult so auto-detection produces no paths.
        session.exec = AsyncMock(
            return_value=ExecResult(stdout="", stderr="", exit_code=0)
        )
        session.read_file = AsyncMock()
        session.upload_file = AsyncMock()
        session.download_file = AsyncMock()
        session.close = AsyncMock()
        session.run_code = AsyncMock()
        session.sandbox_id = "test"

        result = await tool.execute(
            session=session,
            code="print(42)",
            language="python",
            event_emitter=emitter,
        )

        assert result.success
        session.exec_stream.assert_called_once()

    @pytest.mark.asyncio
    async def test_falls_back_to_auto_detected_artifact_when_explicit_output_is_missing(
        self,
    ) -> None:
        tool = CodeRun()

        async def exec_side_effect(command: str, timeout: int | None = None, **kwargs):
            del timeout, kwargs
            if "-printf '%p\\t%s\\t%T@\\n'" in command:
                return ExecResult(stdout="", stderr="", exit_code=0)
            if command.startswith("touch /tmp/_cr_ts_"):
                return ExecResult(stdout="", stderr="", exit_code=0)
            if command.startswith("python3 /tmp/_code_run.py"):
                return ExecResult(stdout="done", stderr="", exit_code=0)
            if "-newer /tmp/_cr_ts_" in command:
                return ExecResult(
                    stdout="/workspace/iPhone17_Pro_Max_价格分析.pptx\n",
                    stderr="",
                    exit_code=0,
                )
            if command.startswith("rm -f /tmp/_cr_ts_"):
                return ExecResult(stdout="", stderr="", exit_code=0)
            if command == "test -f '/home/user/iPhone17_Pro_Max_价格分析.pptx'":
                return ExecResult(stdout="", stderr="", exit_code=1)
            raise AssertionError(f"Unexpected command: {command}")

        session = MagicMock()
        session.write_file = AsyncMock()
        session.exec = AsyncMock(side_effect=exec_side_effect)

        result = await tool.execute(
            session=session,
            code="print('done')",
            language="python",
            output_files=["/home/user/iPhone17_Pro_Max_价格分析.pptx"],
        )

        assert result.success
        assert result.output == "done"
        assert (result.metadata or {}).get("artifact_paths") == [
            "/workspace/iPhone17_Pro_Max_价格分析.pptx"
        ]


class TestEventTypes:
    def test_new_event_types_exist(self) -> None:
        assert EventType.SANDBOX_STDOUT == "sandbox_stdout"
        assert EventType.SANDBOX_STDERR == "sandbox_stderr"
        assert EventType.CODE_RESULT == "code_result"
