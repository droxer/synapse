"""Shell command execution inside a sandbox."""

from __future__ import annotations

import asyncio
import re
from typing import Any

import boxlite

from agent.sandbox.base import ExtendedSandboxSession
from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)

_VALID_SESSION_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _make_stream_callbacks(
    event_emitter: Any,
) -> tuple[Any, Any]:
    """Create thread-safe stdout/stderr callbacks that emit SSE events."""
    from api.events import EventType

    loop = asyncio.get_running_loop()

    def on_stdout(line: str) -> None:
        asyncio.run_coroutine_threadsafe(
            event_emitter.emit(EventType.SANDBOX_STDOUT, {"text": line}),
            loop,
        )

    def on_stderr(line: str) -> None:
        asyncio.run_coroutine_threadsafe(
            event_emitter.emit(EventType.SANDBOX_STDERR, {"text": line}),
            loop,
        )

    return on_stdout, on_stderr


class ShellExec(SandboxTool):
    """Execute a shell command inside the sandbox."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="shell_exec",
            description="Execute a shell command inside the sandbox environment.",
            input_schema={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute.",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (ignored when id is set).",
                        "default": 30,
                    },
                    "workdir": {
                        "type": "string",
                        "description": "Working directory for the command.",
                    },
                    "output_files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Absolute paths of files created or modified by "
                            "this command that should be saved as downloadable "
                            "artifacts. Only include files the user would want "
                            "to view or download."
                        ),
                    },
                    "id": {
                        "type": "string",
                        "description": (
                            "Optional session name. When provided, the command "
                            "runs as a named background session and returns "
                            "immediately. Use shell_view, shell_wait, shell_write, "
                            "and shell_kill to interact with the session."
                        ),
                    },
                },
                "required": ["command"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("shell", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        command: str = kwargs.get("command", "")
        timeout: int = kwargs.get("timeout", 30)
        workdir: str | None = kwargs.get("workdir")
        output_files: list[str] = kwargs.get("output_files") or []
        event_emitter: Any | None = kwargs.get("event_emitter")
        session_id: str | None = kwargs.get("id")

        if not command.strip():
            return ToolResult.fail("Command must not be empty")

        # Named background session mode
        if session_id is not None and session_id.strip():
            clean_id = session_id.strip()
            if not _VALID_SESSION_ID.match(clean_id):
                return ToolResult.fail(
                    "Invalid session id. Use 1-64 alphanumeric characters, hyphens, or underscores."
                )
            return await self._start_background_session(
                session, command, clean_id, workdir
            )

        try:
            use_streaming = event_emitter is not None and isinstance(
                session, ExtendedSandboxSession
            )

            if use_streaming:
                on_stdout, on_stderr = _make_stream_callbacks(event_emitter)
                result = await session.exec_stream(
                    command,
                    on_stdout=on_stdout,
                    on_stderr=on_stderr,
                    timeout=timeout,
                    workdir=workdir,
                )
            else:
                result = await session.exec(command, timeout=timeout, workdir=workdir)
        except boxlite.BoxliteError as exc:
            if "invalidated" in str(exc).lower() or "stop" in str(exc).lower():
                return ToolResult.fail(
                    "The sandbox session is no longer available. "
                    "It may have been destroyed due to conversation ending or timeout."
                )
            return ToolResult.fail(f"Sandbox error: {exc}")
        except Exception as exc:
            return ToolResult.fail(f"Shell execution failed: {exc}")

        combined = result.stdout
        if result.stderr:
            combined = (
                f"{combined}\n[stderr]\n{result.stderr}" if combined else result.stderr
            )

        metadata: dict[str, Any] = {"exit_code": result.exit_code}
        if output_files:
            metadata["artifact_paths"] = list(output_files)

        return ToolResult.ok(combined, metadata=metadata)

    async def _start_background_session(
        self,
        session: Any,
        command: str,
        session_id: str,
        workdir: str | None,
    ) -> ToolResult:
        """Start a command as a named background session."""
        from agent.tools.sandbox.shell_tools import _SESSION_DIR

        sdir = f"{_SESSION_DIR}/{session_id}"

        # Build the startup script.
        # The wrapper records the exit code to a file so shell_wait can
        # read it reliably (the `wait` builtin only works for child processes
        # of the same shell).
        cd_prefix = f"cd {workdir} && " if workdir else ""
        escaped_cmd = command.replace("'", "'\\''")
        start_script = (
            f"mkdir -p {sdir} && "
            f"mkfifo {sdir}/stdin_pipe 2>/dev/null; "
            f"nohup sh -c '"
            f"exec 0< {sdir}/stdin_pipe; "
            f"{cd_prefix}{escaped_cmd}; "
            f"echo $? > {sdir}/exit_code"
            f"' > {sdir}/stdout.log 2> {sdir}/stderr.log & "
            f"BGPID=$!; "
            f"echo $BGPID > {sdir}/pid; "
            f"echo $BGPID"
        )

        try:
            result = await session.exec(start_script, timeout=10)
        except Exception as exc:
            return ToolResult.fail(f"Failed to start session '{session_id}': {exc}")

        pid_str = result.stdout.strip()
        if result.exit_code != 0 or not pid_str:
            return ToolResult.fail(
                f"Failed to start session '{session_id}': {result.stderr or 'no PID returned'}"
            )

        return ToolResult.ok(
            f"Started background session '{session_id}' (PID: {pid_str})\n"
            f"Use shell_view to check output, shell_write to send input, "
            f"shell_wait to wait for completion, or shell_kill to stop it.",
            metadata={"session_id": session_id, "pid": int(pid_str)},
        )
